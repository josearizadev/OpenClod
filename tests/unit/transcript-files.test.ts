import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sessionRefFromFile } from '../../src/main/services/claude-paths'
import { loadSession } from '../../src/main/services/session-loader'
import {
  changeCounts,
  displayPath,
  touchedFiles
} from '../../src/renderer/src/lib/transcript/files'
import type { TranscriptItem } from '../../src/shared/sessions'
import { diskFile } from './chat-fixtures'

const NUBE = join(
  __dirname,
  '../fixtures/claude/projects/Z--web-Nube/0e56deca-67ad-4d7c-bc94-a61cc14540cd.jsonl'
)

async function load(file: string): Promise<{ items: TranscriptItem[]; cwd?: string }> {
  const loaded = await loadSession(await sessionRefFromFile(file))
  return { items: loaded.items, ...(loaded.summary.cwd ? { cwd: loaded.summary.cwd } : {}) }
}

let line = 0
function use(id: string, name: string, input: unknown): TranscriptItem {
  return { line: ++line, uuid: `u${line}`, sidechain: false, kind: 'tool-use', id, name, input }
}
function result(id: string, isError = false): TranscriptItem {
  return {
    line: ++line,
    uuid: `u${line}`,
    sidechain: false,
    kind: 'tool-result',
    toolUseId: id,
    isError,
    text: ''
  }
}

describe('touchedFiles', () => {
  it('fixture de edición: notas.txt creado y luego editado, con +N −M', async () => {
    const { items, cwd } = await load(diskFile('edicion'))
    const files = touchedFiles(items, cwd)
    expect(files).toEqual([
      expect.objectContaining({
        path: 'notas.txt',
        status: 'created',
        added: 2,
        removed: 1,
        commands: []
      })
    ])
    expect(files[0]?.changes.map((c) => [c.tool, c.added, c.removed, c.status])).toEqual([
      ['Write', 1, 0, 'ok'],
      ['Edit', 1, 1, 'ok']
    ])
    // El `git init` denegado no es una operación de archivos.
  })

  it('una sesión real de Nube: relativos al proyecto (los de fuera, completos), ordenados y sin repetidos', async () => {
    const { items, cwd } = await load(NUBE)
    const files = touchedFiles(items, cwd)
    expect(files.length).toBeGreaterThan(0)
    const keys = files.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const file of files) {
      // Dentro del proyecto, relativa; fuera (p. ej. el plan en la carpeta de Claude Code), completa.
      if (/^[a-zA-Z]:/.test(file.path)) expect(file.path.toLowerCase()).not.toContain('/web/nube/')
      expect(file.changes.length + file.commands.length).toBeGreaterThan(0)
      expect(file.added).toBe(file.changes.reduce((n, c) => n + c.added, 0))
    }
    expect([...files.map((f) => f.path)].sort((a, b) => a.localeCompare(b))).toEqual(
      files.map((f) => f.path)
    )
  })

  it('las llamadas con error no cuentan; sin resultado solo si la sesión trabaja', () => {
    const items = [
      use('a', 'Write', { file_path: 'C:\\p\\a.txt', content: 'x\ny\n' }),
      result('a', true),
      use('b', 'Edit', { file_path: 'C:\\p\\b.txt', old_string: 'x', new_string: 'y' })
    ]
    expect(touchedFiles(items, 'C:\\p')).toEqual([])
    const running = touchedFiles(items, 'C:\\p', { running: true })
    expect(running.map((f) => [f.path, f.status, f.changes[0]?.status])).toEqual([
      ['b.txt', 'edited', 'running']
    ])
  })

  it('Windows: agrupa sin distinguir mayúsculas ni separadores', () => {
    const items = [
      use('a', 'Write', { file_path: 'C:\\P\\src\\A.ts', content: 'uno' }),
      result('a'),
      use('b', 'Edit', { file_path: 'c:/p/src/a.ts', old_string: 'uno', new_string: 'dos' }),
      result('b'),
      use('c', 'NotebookEdit', { notebook_path: 'C:\\p\\n.ipynb', new_source: 'print(1)' }),
      result('c')
    ]
    const files = touchedFiles(items, 'C:\\p')
    expect(files.map((f) => [f.path, f.status, f.changes.length, f.added, f.removed])).toEqual([
      ['n.ipynb', 'edited', 1, 1, 0],
      ['src/A.ts', 'created', 2, 2, 1]
    ])
  })

  it('comandos: borrado, movimiento y creación detectados, sin diff', () => {
    const items = [
      use('w', 'Write', { file_path: 'C:\\p\\viejo.txt', content: 'x' }),
      result('w'),
      use('m', 'Bash', { command: 'mv viejo.txt nuevo.txt' }),
      result('m'),
      use('r', 'PowerShell', { command: 'Remove-Item -Path "C:\\p\\borrar.log"' }),
      result('r'),
      use('x', 'Bash', { command: 'rm *.tmp' }),
      result('x')
    ]
    const files = touchedFiles(items, 'C:\\p')
    expect(files.map((f) => [f.path, f.status, f.commands.map((c) => c.op)])).toEqual([
      ['borrar.log', 'command', ['deleted']],
      ['nuevo.txt', 'command', ['moved-to']],
      ['viejo.txt', 'deleted', ['moved-from']]
    ])
  })

  it('MultiEdit suma sus cambios; displayPath deja fuera lo que no está en la carpeta', () => {
    expect(
      changeCounts('MultiEdit', {
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c\nd', new_string: 'c' }
        ]
      })
    ).toEqual({ added: 2, removed: 3 })
    expect(displayPath('D:\\otro\\x.ts', 'C:\\p')).toBe('D:/otro/x.ts')
    expect(displayPath('/z/web/Nube/a.vue', 'Z:\\web\\Nube')).toBe('a.vue')
  })
})
