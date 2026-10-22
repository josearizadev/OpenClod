import type { TranscriptItem } from '../../../../shared/sessions'
import { lineDiff } from './diff'
import { shellFileOps } from './shell-files'

/**
 * Archivos que ha tocado una sesión, derivados de su
 * transcript: igual para sesiones antiguas y activas. Puro.
 */

export type FileTool = 'Write' | 'Edit' | 'MultiEdit' | 'NotebookEdit'

export interface FileChange {
  toolUseId: string
  tool: FileTool
  input: unknown
  timestamp?: string
  added: number
  removed: number
  /** `running` = aún sin resultado en una sesión activa. */
  status: 'ok' | 'running'
}

export interface CommandOp {
  toolUseId: string
  op: 'deleted' | 'created' | 'moved-from' | 'moved-to'
  command: string
  timestamp?: string
}

export interface TouchedFile {
  /** Ruta normalizada (separadores `/`, minúsculas en Windows): agrupa. */
  key: string
  /** Relativa a la carpeta de la sesión si está dentro. */
  path: string
  status: 'created' | 'edited' | 'deleted' | 'command'
  added: number
  removed: number
  changes: FileChange[]
  /** Detectado por comando, sin diff. */
  commands: CommandOp[]
}

const FILE_TOOLS = new Set<string>(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function lines(text: string): number {
  if (text === '') return 0
  return text.replace(/\n$/, '').split('\n').length
}

function counts(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of lineDiff(before, after, 0)) {
    if (row.type === 'add') added++
    else if (row.type === 'del') removed++
  }
  return { added, removed }
}

/** `+N −M` de una llamada a partir de su entrada. */
export function changeCounts(tool: FileTool, input: unknown): { added: number; removed: number } {
  const obj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  switch (tool) {
    case 'Write':
      return { added: lines(str(obj['content']) ?? ''), removed: 0 }
    case 'Edit':
      return counts(str(obj['old_string']) ?? '', str(obj['new_string']) ?? '')
    case 'MultiEdit': {
      const edits = Array.isArray(obj['edits']) ? obj['edits'] : []
      return edits.reduce<{ added: number; removed: number }>(
        (sum, edit) => {
          const e = (typeof edit === 'object' && edit !== null ? edit : {}) as Record<
            string,
            unknown
          >
          const c = counts(str(e['old_string']) ?? '', str(e['new_string']) ?? '')
          return { added: sum.added + c.added, removed: sum.removed + c.removed }
        },
        { added: 0, removed: 0 }
      )
    }
    case 'NotebookEdit':
      return { added: lines(str(obj['new_source']) ?? ''), removed: 0 }
  }
}

function pathOf(input: unknown): string | undefined {
  const obj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return str(obj['file_path']) ?? str(obj['notebook_path'])
}

function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/^\/([a-zA-Z])(?=\/)/, '$1:')
  return /^[a-zA-Z]:/.test(slashed) ? slashed.toLowerCase() : slashed
}

/** Ruta relativa a `cwd` (con `/`) si está dentro; si no, la ruta tal cual. */
export function displayPath(path: string, cwd: string | undefined): string {
  if (!cwd) return path.replace(/\\/g, '/')
  const base = normalize(cwd).replace(/\/+$/, '')
  const full = normalize(path)
  if (full.startsWith(`${base}/`)) return path.replace(/\\/g, '/').slice(base.length + 1)
  return path.replace(/\\/g, '/')
}

/** Ruta absoluta de lo que escribe un comando: relativa a la carpeta de la sesión. */
function absolute(path: string, cwd: string | undefined): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(path) || !cwd) return path
  return `${cwd.replace(/[\\/]+$/, '')}/${path.replace(/^\.[\\/]/, '')}`
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

export function touchedFiles(
  items: readonly TranscriptItem[],
  cwd: string | undefined,
  options: { running?: boolean } = {}
): TouchedFile[] {
  const results = new Map<string, boolean>()
  for (const item of items) {
    if (item.kind === 'tool-result') results.set(item.toolUseId, item.isError)
  }

  const files = new Map<string, TouchedFile>()
  const fileOf = (path: string): TouchedFile => {
    const key = normalize(absolute(path, cwd))
    let file = files.get(key)
    if (!file) {
      file = {
        key,
        path: displayPath(absolute(path, cwd), cwd),
        status: 'command',
        added: 0,
        removed: 0,
        changes: [],
        commands: []
      }
      files.set(key, file)
    }
    return file
  }

  for (const item of items) {
    if (item.kind !== 'tool-use') continue
    const isError = results.get(item.id)
    if (isError === true) continue
    const pending = isError === undefined
    // Sin resultado: solo cuenta mientras la sesión trabaja (en curso); si no, no se hizo.
    if (pending && !options.running) continue

    if (FILE_TOOLS.has(item.name)) {
      const path = pathOf(item.input)
      if (!path) continue
      const tool = item.name as FileTool
      const file = fileOf(path)
      const { added, removed } = changeCounts(tool, item.input)
      if (file.changes.length === 0 && file.commands.length === 0)
        file.status = tool === 'Write' ? 'created' : 'edited'
      else if (file.status === 'command' || file.status === 'deleted') file.status = 'edited'
      file.changes.push({
        toolUseId: item.id,
        tool,
        input: item.input,
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
        added,
        removed,
        status: pending ? 'running' : 'ok'
      })
      file.added += added
      file.removed += removed
    } else if (SHELL_TOOLS.has(item.name) && !pending) {
      const command = str((item.input as Record<string, unknown> | null)?.['command']) ?? ''
      for (const op of shellFileOps(command)) {
        const base = {
          toolUseId: item.id,
          command,
          ...(item.timestamp ? { timestamp: item.timestamp } : {})
        }
        if (op.op === 'moved') {
          fileOf(op.from).commands.push({ ...base, op: 'moved-from' })
          const to = fileOf(op.to)
          to.commands.push({ ...base, op: 'moved-to' })
          const from = fileOf(op.from)
          if (from.changes.length > 0) from.status = 'deleted'
        } else {
          const file = fileOf(op.path)
          file.commands.push({ ...base, op: op.op })
          if (op.op === 'deleted' && file.changes.length > 0) file.status = 'deleted'
        }
      }
    }
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}
