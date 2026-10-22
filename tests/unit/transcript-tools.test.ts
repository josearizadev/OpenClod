import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listProjects } from '../../src/main/services/claude-paths'
import { loadSession } from '../../src/main/services/session-loader'
import { lineDiff } from '../../src/renderer/src/lib/transcript/diff'
import {
  groupLabel,
  languageOf,
  relativePath,
  toolCategory,
  toolSummary
} from '../../src/renderer/src/lib/transcript/tools'
import type { TranscriptItem } from '../../src/shared/sessions'

const FIXTURES = join(__dirname, '../fixtures/claude')

describe('toolSummary', () => {
  it.each([
    ['Bash', { command: 'npm test\nnpm run lint', description: 'x' }, 'npm test …'],
    ['PowerShell', { command: 'Get-ChildItem' }, 'Get-ChildItem'],
    ['Read', { file_path: 'Z:\\web\\Nube\\src\\a.ts' }, 'src\\a.ts'],
    ['Edit', { file_path: 'z:/web/nube/app/Models/User.php' }, 'app/Models/User.php'],
    ['Write', { file_path: 'C:\\otra\\b.md', content: '' }, 'C:\\otra\\b.md'],
    ['Grep', { pattern: 'foo', path: 'Z:\\web\\Nube\\src' }, 'foo · src'],
    ['Grep', { pattern: 'foo' }, 'foo'],
    ['Glob', { pattern: '**/*.vue' }, '**/*.vue'],
    ['WebFetch', { url: 'https://example.com', prompt: 'x' }, 'https://example.com'],
    ['WebSearch', { query: 'shiki' }, 'shiki'],
    ['ToolSearch', { query: 'select:WebFetch', max_results: 1 }, 'select:WebFetch'],
    ['Agent', { description: 'Explora', prompt: 'largo' }, 'Explora'],
    ['Skill', { skill: 'run', args: 'x' }, 'run'],
    ['TaskCreate', { subject: 'Fase 1', description: 'x' }, 'Fase 1'],
    ['TaskUpdate', { taskId: '1', status: 'in_progress' }, '#1 · in_progress'],
    [
      'AskUserQuestion',
      { questions: [{ question: '¿Qué quieres?', options: [] }] },
      '¿Qué quieres?'
    ],
    ['ExitPlanMode', { plan: '# Hogares\n\nTexto' }, 'Hogares …'],
    ['mcp__phpstorm__get_file', { path: 'x' }, 'phpstorm · get_file'],
    ['Desconocida', { a: 3, b: 'segundo' }, 'segundo'],
    ['EnterPlanMode', {}, '']
  ])('%s', (name, input, expected) => {
    expect(toolSummary(name, input, 'Z:\\web\\Nube')).toBe(expected)
  })

  it('entradas raras no lanzan', () => {
    for (const input of [null, undefined, 3, 'texto', [], { command: 3 }, { questions: 'x' }]) {
      expect(() => toolSummary('Bash', input)).not.toThrow()
      expect(() => toolSummary('AskUserQuestion', input)).not.toThrow()
      expect(() => toolSummary('Otra', input)).not.toThrow()
    }
    expect(toolSummary('Bash', null)).toBe('')
    expect(toolSummary('AskUserQuestion', { questions: 'x' })).toBe('')
  })

  it('todas las llamadas reales de los fixtures tienen resumen', async () => {
    const listed = await listProjects(FIXTURES)
    if (!listed.ok) throw new Error(listed.reason)
    const calls: Extract<TranscriptItem, { kind: 'tool-use' }>[] = []
    for (const ref of listed.projects.flatMap((p) => p.sessions)) {
      const loaded = await loadSession(ref)
      for (const items of [loaded.items, ...loaded.subagentItems.values()]) {
        for (const item of items) if (item.kind === 'tool-use') calls.push(item)
      }
    }
    expect(calls.length).toBeGreaterThan(200)
    // Sin resumen solo las que no traen ningún texto (p. ej. `EnterPlanMode` o una entrada que
    // Claude Code no pudo interpretar, `__unparsedToolInput`).
    const hasText = (input: unknown): boolean =>
      typeof input === 'object' &&
      input !== null &&
      Object.values(input).some((v) => typeof v === 'string' && v !== '')
    const empty = calls.filter(
      (c) => hasText(c.input) && toolSummary(c.name, c.input, 'Z:\\web\\Nube') === ''
    )
    expect(empty.map((c) => c.name)).toEqual([])
  })
})

describe('relativePath', () => {
  it('Windows, Git Bash y mayúsculas distintas', () => {
    expect(relativePath('Z:\\web\\Nube\\a\\b.ts', 'Z:\\web\\Nube')).toBe('a\\b.ts')
    expect(relativePath('/z/web/Nube/a/b.ts', 'Z:\\web\\Nube')).toBe('a/b.ts')
    expect(relativePath('Z:/WEB/nube/a.ts', '/z/web/Nube')).toBe('a.ts')
    expect(relativePath('Z:\\web\\Nube', 'Z:\\web\\Nube\\')).toBe('.')
    expect(relativePath('Z:\\web\\Nubex\\a.ts', 'Z:\\web\\Nube')).toBe('Z:\\web\\Nubex\\a.ts')
    expect(relativePath('/home/u/p/a.ts', '/home/u/p')).toBe('a.ts')
    expect(relativePath('a.ts', undefined)).toBe('a.ts')
  })
})

describe('groupLabel', () => {
  const calls = (...names: string[]): { name: string }[] => names.map((name) => ({ name }))
  it.each([
    [calls('Read'), 'Leyó 1 archivo'],
    [calls('Read', 'Read', 'Read'), 'Leyó 3 archivos'],
    [
      calls('Read', 'Read', 'Read', 'Edit', 'Bash', 'Bash'),
      'Leyó 3 archivos, editó 1 y ejecutó 2 comandos'
    ],
    [calls('Bash', 'Grep', 'Glob'), 'Ejecutó 1 comando y buscó 2 veces'],
    [
      calls('WebSearch', 'Agent', 'mcp__x__y'),
      'Consultó 1 página, lanzó 1 subagente y usó 1 herramienta'
    ],
    [calls('Write', 'Write'), 'Escribió 2 archivos']
  ])('%#', (input, expected) => {
    expect(groupLabel(input)).toBe(expected)
  })

  it('con thinking empieza por «Pensó»', () => {
    expect(groupLabel(calls('Bash', 'Bash', 'Read'), { thought: true })).toBe(
      'Pensó, ejecutó 2 comandos y leyó 1 archivo'
    )
    expect(groupLabel(calls('Bash'), { thought: true })).toBe('Pensó y ejecutó 1 comando')
  })

  it('categorías', () => {
    expect(toolCategory('PowerShell')).toBe('run')
    expect(toolCategory('MultiEdit')).toBe('edit')
    expect(toolCategory('Nueva')).toBe('other')
  })
})

describe('languageOf', () => {
  it.each([
    ['src/a.ts', 'ts'],
    ['C:\\x\\App.vue', 'vue'],
    ['programas.ahk', 'ahk'],
    ['script.PS1', 'powershell'],
    ['README.md', 'markdown'],
    ['Makefile', 'text'],
    ['.gitignore', 'text'],
    ['raro.xyz', 'text']
  ])('%s → %s', (path, lang) => {
    expect(languageOf(path)).toBe(lang)
  })
})

describe('lineDiff', () => {
  it('cambio en medio con contexto de 3 líneas y el resto plegado', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'L10')
    const rows = lineDiff(before, after)
    expect(rows[0]).toEqual({ type: 'skip', count: 7 })
    expect(rows.filter((r) => r.type === 'ctx')).toHaveLength(6)
    expect(rows.filter((r) => r.type === 'del')).toEqual([{ type: 'del', text: 'l10' }])
    expect(rows.filter((r) => r.type === 'add')).toEqual([{ type: 'add', text: 'L10' }])
    expect(rows[rows.length - 1]).toEqual({ type: 'skip', count: 6 })
  })

  it('texto nuevo sin anterior y sin salto final', () => {
    expect(lineDiff('', 'a\nb')).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' }
    ])
    expect(lineDiff('a', 'a')).toEqual([{ type: 'ctx', text: 'a' }])
  })
})
