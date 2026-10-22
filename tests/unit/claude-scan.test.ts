import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scanClaude } from '../../src/main/services/claude-scan'
import { ClaudeScanReportSchema } from '../../src/shared/sessions'

const FIXTURES = join(__dirname, '../fixtures/claude')

function mtimes(dir: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name)
    out.set(path, statSync(path).mtimeMs)
  }
  return out
}

describe('scanClaude', () => {
  it('agrega los fixtures con el uso deduplicado entre sesiones', async () => {
    const report = await scanClaude({ dir: FIXTURES, source: 'default' })
    expect(ClaudeScanReportSchema.safeParse(report).success).toBe(true)
    expect(report).toMatchObject({
      dir: FIXTURES,
      source: 'default',
      ok: true,
      projects: 3,
      sessions: 6,
      subagents: 6,
      invalidLines: 1,
      unknownLineTypes: { 'nuevo-tipo': 1, '(sin tipo)': 1 },
      unknownBlockTypes: { future_block: 1, '(contenido no reconocido)': 1 },
      // a55accdd → 9c81d504
      continuedSessions: 1,
      conversationLinks: 1,
      unlinkedOverlaps: 0,
      brokenLinks: 0,
      linkIssues: []
    })
    // Recuento independiente (scripts/recuento-tokens.py, línea GLOBAL): la sesión continuada
    // copia 19 mensajes de la original, que solo cuentan una vez.
    expect(report.usage).toEqual({
      input: 502,
      output: 329810,
      cacheCreation: 859933,
      cacheRead: 47904907
    })
    expect(report.usageEvents).toBe(246)
    expect(report.cliVersions[0]).toBe('2.1.274')
    expect(report.cliVersions.at(-1)).toBe('2.1.300')
    expect(report.sessionsWithIssues).toEqual([
      {
        file: join('projects', 'Z--demo', '00000000-0000-4000-8000-000000000001.jsonl'),
        invalidLines: 1,
        unknown: 4
      }
    ])
  })

  it('no modifica nada en la carpeta de Claude Code', async () => {
    const before = mtimes(FIXTURES)
    await scanClaude({ dir: FIXTURES, source: 'default' })
    expect(mtimes(FIXTURES)).toEqual(before)
  })

  it('si la carpeta no existe devuelve ok: false con el motivo', async () => {
    const dir = join(tmpdir(), 'no-existe-bitacora-claude')
    const report = await scanClaude({ dir, source: 'env' }, { warn: vi.fn() })
    expect(report).toMatchObject({ ok: false, source: 'env', sessions: 0, projects: 0 })
    expect(report.reason).toMatch(/^No existe la carpeta/)
  })
})
