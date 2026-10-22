import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listProjects, resolveClaudeDir } from '../../src/main/services/claude-paths'

/** Copia anonimizada de `~/.claude` con la misma estructura (ver scripts/anonimizar-fixture.mjs). */
const FIXTURES = join(__dirname, '../fixtures/claude')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveClaudeDir', () => {
  const home = resolve('/home/usuario')

  it('usa la carpeta de los ajustes antes que la variable de entorno', () => {
    const result = resolveClaudeDir({
      configured: '/datos/claude',
      env: { CLAUDE_CONFIG_DIR: '/otra' },
      home
    })
    expect(result).toEqual({ dir: resolve('/datos/claude'), source: 'settings' })
  })

  it('usa CLAUDE_CONFIG_DIR si no hay ajuste', () => {
    const result = resolveClaudeDir({ configured: null, env: { CLAUDE_CONFIG_DIR: '/otra' }, home })
    expect(result).toEqual({ dir: resolve('/otra'), source: 'env' })
  })

  it('cae a ~/.claude y trata los valores vacíos como no definidos', () => {
    const result = resolveClaudeDir({ configured: '  ', env: { CLAUDE_CONFIG_DIR: '' }, home })
    expect(result).toEqual({ dir: join(home, '.claude'), source: 'default' })
  })
})

describe('listProjects', () => {
  it('lista proyectos, sesiones principales y subagentes de los fixtures', async () => {
    const result = await listProjects(FIXTURES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.projects.map((p) => p.name)).toEqual(['C--Programas', 'Z--demo', 'Z--web-Nube'])
    const nube = result.projects.find((p) => p.name === 'Z--web-Nube')
    expect(nube?.sessions.map((s) => s.sessionId)).toEqual([
      '07319c10-f4d8-43f5-b876-ec4c89ae65d4',
      '0e56deca-67ad-4d7c-bc94-a61cc14540cd',
      '9c81d504-7ee7-4a60-a274-500078e29ce3',
      'a55accdd-171f-4711-936e-b51294a4b423'
    ])
    const a55 = nube?.sessions.find((s) => s.sessionId.startsWith('a55accdd'))
    expect(a55?.size).toBeGreaterThan(0)
    expect(a55?.subagents.map((s) => s.agentId)).toEqual([
      'a3aa898a77e40ab58',
      'a8bf231e68420c4fd',
      'a8ec5f2f2b4b0845b'
    ])
    expect(a55?.subagents[0]?.metaFile).toMatch(/agent-a3aa898a77e40ab58\.meta\.json$/)
  })

  it('ignora memory/, tool-results/ y archivos que no son .jsonl', async () => {
    const result = await listProjects(FIXTURES)
    if (!result.ok) throw new Error(result.reason)
    const files = result.projects.flatMap((p) => p.sessions.map((s) => s.file))
    expect(files.every((f) => f.endsWith('.jsonl'))).toBe(true)
    expect(files.some((f) => /memory|tool-results/.test(f))).toBe(false)
    expect(files).toHaveLength(6)
  })

  it('un subagente sin .meta.json se lista sin metaFile', async () => {
    const base = mkdtempSync(join(tmpdir(), 'bitacora-paths-'))
    dirs.push(base)
    const sub = join(base, 'projects', 'P', 's1', 'subagents')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(base, 'projects', 'P', 's1.jsonl'), '')
    writeFileSync(join(sub, 'agent-x1.jsonl'), '')
    writeFileSync(join(base, 'projects', 'suelto.jsonl'), '')
    const result = await listProjects(base)
    if (!result.ok) throw new Error(result.reason)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]?.sessions[0]?.subagents).toEqual([
      { agentId: 'x1', file: join(sub, 'agent-x1.jsonl') }
    ])
  })

  it('si no existe la carpeta devuelve ok: false con el motivo, sin lanzar', async () => {
    const result = await listProjects(join(tmpdir(), 'no-existe-bitacora-xyz'), { warn: vi.fn() })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/^No existe la carpeta/)
  })
})
