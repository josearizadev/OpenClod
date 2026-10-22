import {
  Bot,
  CircleHelp,
  ClipboardList,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  Puzzle,
  Search,
  SquareTerminal,
  Wrench
} from 'lucide-vue-next'
import type { Component } from 'vue'

/**
 * Presentación de las herramientas de Claude Code: argumento principal,
 * categoría para la etiqueta del grupo, icono y lenguaje para el resaltado. Nunca lanza: una
 * entrada con forma desconocida da un resumen vacío.
 */

export type ToolCategory = 'read' | 'search' | 'edit' | 'write' | 'run' | 'web' | 'agent' | 'other'

const CATEGORIES: Record<string, ToolCategory> = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  ToolSearch: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
  Bash: 'run',
  PowerShell: 'run',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent'
}

const ICONS: Record<string, Component> = {
  Read: FileText,
  NotebookRead: FileText,
  Glob: FolderSearch,
  LS: FolderSearch,
  Grep: Search,
  ToolSearch: Search,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Write: FilePlus,
  Bash: SquareTerminal,
  PowerShell: SquareTerminal,
  WebFetch: Globe,
  WebSearch: Globe,
  TodoWrite: ListTodo,
  TaskCreate: ListTodo,
  TaskUpdate: ListTodo,
  TaskStop: ListTodo,
  Agent: Bot,
  Task: Bot,
  Skill: Puzzle,
  AskUserQuestion: CircleHelp,
  ExitPlanMode: ClipboardList,
  EnterPlanMode: ClipboardList
}

export function toolCategory(name: string): ToolCategory {
  return CATEGORIES[name] ?? 'other'
}

/** Icono de la herramienta (una sola tabla para el visor y el chat). */
export function toolIcon(name: string): Component {
  return ICONS[name] ?? Wrench
}

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? ''
  return text.includes('\n') ? `${line} …` : line
}

/** Ruta relativa a `cwd` si está dentro (con formas Windows y Git Bash mezcladas). */
export function relativePath(path: string, cwd: string | undefined): string {
  if (!cwd) return path
  const norm = (p: string): string =>
    p
      .replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
  const base = norm(cwd)
  const full = norm(path)
  const windows = /^[a-zA-Z]:/.test(base)
  const a = windows ? base.toLowerCase() : base
  const b = windows ? full.toLowerCase() : full
  if (b === a) return '.'
  // `/z` y `Z:` miden lo mismo: se corta la ruta original y conserva sus separadores.
  if (b.startsWith(`${a}/`)) return path.slice(base.length + 1)
  return path
}

/** Argumento principal de la llamada, en una línea. */
export function toolSummary(name: string, input: unknown, cwd?: string): string {
  try {
    const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
    if (mcp) return `${mcp[1]} · ${mcp[2]}`
    switch (name) {
      case 'Bash':
      case 'PowerShell':
        return firstLine(field(input, 'command') ?? '')
      case 'Read':
      case 'Edit':
      case 'MultiEdit':
      case 'Write':
      case 'NotebookEdit':
      case 'NotebookRead': {
        const path = field(input, 'file_path') ?? field(input, 'notebook_path')
        return path ? relativePath(path, cwd) : ''
      }
      case 'Grep': {
        const pattern = field(input, 'pattern') ?? ''
        const path = field(input, 'path')
        return path ? `${pattern} · ${relativePath(path, cwd)}` : pattern
      }
      case 'Glob':
        return field(input, 'pattern') ?? ''
      case 'LS':
        return relativePath(field(input, 'path') ?? '', cwd)
      case 'WebFetch':
        return field(input, 'url') ?? ''
      case 'WebSearch':
      case 'ToolSearch':
        return field(input, 'query') ?? ''
      case 'Agent':
      case 'Task':
        return field(input, 'description') ?? ''
      case 'Skill':
        return field(input, 'skill') ?? ''
      case 'TaskCreate':
        return field(input, 'subject') ?? ''
      case 'TaskUpdate': {
        const status = field(input, 'status')
        const id = field(input, 'taskId')
        return [id ? `#${id}` : '', status ?? ''].filter(Boolean).join(' · ')
      }
      case 'AskUserQuestion': {
        const questions = (input as { questions?: unknown }).questions
        const first = Array.isArray(questions) ? (questions[0] as unknown) : undefined
        return firstLine(field(first, 'question') ?? '')
      }
      case 'ExitPlanMode':
        return firstLine((field(input, 'plan') ?? '').replace(/^#+\s*/, ''))
    }
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      for (const value of Object.values(input)) {
        if (typeof value === 'string' && value.trim() !== '') return firstLine(value)
      }
    }
    return ''
  } catch {
    return ''
  }
}

const VERBS: Record<ToolCategory, [string, string, string]> = {
  // [verbo, singular, plural]
  read: ['leyó', 'archivo', 'archivos'],
  search: ['buscó', 'vez', 'veces'],
  edit: ['editó', 'archivo', 'archivos'],
  write: ['escribió', 'archivo', 'archivos'],
  run: ['ejecutó', 'comando', 'comandos'],
  web: ['consultó', 'página', 'páginas'],
  agent: ['lanzó', 'subagente', 'subagentes'],
  other: ['usó', 'herramienta', 'herramientas']
}

/**
 * «Leyó 3 archivos, editó 1 y ejecutó 2 comandos» (orden de primera aparición). Con
 * `thought`, empieza por «Pensó» (grupo de actividad).
 */
export function groupLabel(
  calls: readonly { name: string }[],
  opts: { thought?: boolean } = {}
): string {
  const counts = new Map<ToolCategory, number>()
  for (const call of calls) {
    const category = toolCategory(call.name)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const parts = [...counts].map(([category, n], index) => {
    const [verb, one, many] = VERBS[category]
    // El sustantivo solo en la primera parte y cuando cambia («editó 1» tras «leyó 3 archivos»).
    const previous = index > 0 ? VERBS[[...counts.keys()][index - 1] as ToolCategory] : null
    const noun = previous && previous[1] === one ? '' : ` ${n === 1 ? one : many}`
    return `${verb} ${n}${noun}`
  })
  if (opts.thought) parts.unshift('pensó')
  const text =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0]
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const LANGUAGES: Record<string, string> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  vue: 'vue',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  diff: 'diff',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  php: 'php',
  xml: 'xml',
  ini: 'ini',
  ahk: 'ahk',
  bat: 'bat',
  cmd: 'bat'
}

/** Lenguaje de resaltado según la extensión; desconocida → `text`. */
export function languageOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'text'
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? 'text'
}

const PERMISSION_VERBS: Record<ToolCategory, string> = {
  read: 'leer',
  search: 'buscar en',
  edit: 'editar',
  write: 'escribir',
  run: 'ejecutar',
  web: 'consultar',
  agent: 'lanzar un subagente para',
  other: 'usar'
}

/** Verbo de la petición de permiso: «Claude quiere **editar** `src/auth.ts`». */
export function permissionVerb(name: string): string {
  return PERMISSION_VERBS[toolCategory(name)]
}
