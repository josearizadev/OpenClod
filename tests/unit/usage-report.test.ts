import type Database from 'better-sqlite3'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import {
  conversationCost,
  costIncrements,
  dayKey,
  indexLimits,
  periodStart,
  usageReport
} from '../../src/main/services/usage-report'
import type { Project } from '../../src/shared/types'

const FIXTURES = join(__dirname, '../fixtures/claude')
const LIMITE = join(__dirname, '../fixtures/fragmentos/limite-alcanzado.jsonl')
const ORIGIN = 'a55accdd-171f-4711-936e-b51294a4b423'
const CONTINUATION = '9c81d504-7ee7-4a60-a274-500078e29ce3'
const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
const dirs: string[] = []
const connections: Database.Database[] = []

afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function indexed(): Promise<Database.Database> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-usage-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  // El final real con el aviso de límite, como una sesión más.
  cpSync(
    LIMITE,
    join(claudeDir, 'projects', 'Z--demo', '488f005f-4894-41e1-aca9-b552547dc26a.jsonl')
  )
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  await runPass(opened.db, claudeDir, quiet)
  return opened.db
}

const NUBE: Project = {
  id: '11111111-1111-4111-8111-111111111111',
  path: 'Z:\\web\\Nube',
  name: 'Nube',
  addedAt: '2026-10-14T10:00:00.000Z',
  lastOpenedAt: null
} as unknown as Project
const NOW = Date.parse('2026-10-15T12:00:00Z')
const ctx = { projects: [NUBE], sessionMeta: {}, showCost: true, now: NOW }

describe('usage_flat', () => {
  it('una fila por mensaje y la misma suma que usage_events', async () => {
    const db = await indexed()
    const sum = 'sum(input + output + cache_creation + cache_read) t, count(*) n'
    const flat = db.prepare(`SELECT ${sum} FROM usage_flat`).get()
    expect(flat).toEqual(db.prepare(`SELECT ${sum} FROM usage_events`).get())
  })

  it('la dueña de cada mensaje es la sesión donde apareció (= ownUsage)', async () => {
    const db = await indexed()
    for (const id of [ORIGIN, CONTINUATION]) {
      const own = db
        .prepare<[string], { t: number }>(
          'SELECT own_input + own_output + own_cache_creation + own_cache_read t FROM sessions WHERE session_id = ?'
        )
        .get(id)
      const flat = db
        .prepare<[string], { t: number }>(
          'SELECT sum(input + output + cache_creation + cache_read) t FROM usage_flat WHERE session_id = ?'
        )
        .get(id)
      expect(flat?.t).toBe(own?.t)
    }
  })
})

describe('usageReport', () => {
  it('«Todo» cuadra con el índice y agrupa por día, proyecto y modelo', async () => {
    const db = await indexed()
    const report = usageReport(db, { period: 'all', scope: 'all', projectId: null }, ctx)
    const total = db
      .prepare<[], { t: number; n: number }>(
        'SELECT sum(input + output + cache_creation + cache_read) t, count(*) n FROM usage_events'
      )
      .get()
    expect(report.totals.tokens).toBe(total?.t)
    expect(report.totals.messages).toBe(total?.n)
    expect(report.daily.reduce((s, d) => s + d.total, 0)).toBe(total?.t)
    expect(report.byProject.reduce((s, p) => s + p.tokens, 0)).toBe(total?.t)
    expect(report.byModel.reduce((s, m) => s + m.tokens, 0)).toBe(total?.t)
    const nube = report.byProject.find((p) => p.name === 'Nube')
    expect(nube).toMatchObject({ imported: true, projectId: NUBE.id })
    expect(report.byProject.some((p) => !p.imported)).toBe(true)
    // Días seguidos, sin huecos, hasta hoy.
    expect(report.daily.at(-1)?.day).toBe(dayKey(NOW))
    expect(report.blocks.some((b) => b.limitHit && b.anchored)).toBe(true)
  })

  it('«Este proyecto» filtra totales pero no los bloques', async () => {
    const db = await indexed()
    const all = usageReport(db, { period: 'all', scope: 'all', projectId: null }, ctx)
    const nube = usageReport(db, { period: 'all', scope: 'project', projectId: NUBE.id }, ctx)
    expect(nube.totals.tokens).toBeLessThan(all.totals.tokens)
    expect(nube.byProject.map((p) => p.name)).toEqual(['Nube'])
    expect(nube.blocks).toEqual(all.blocks)
  })

  it('el periodo corta por medianoche local', () => {
    const today = periodStart('today', NOW) as number
    expect(new Date(today).getHours()).toBe(0)
    expect(dayKey(today)).toBe(dayKey(NOW))
    expect(periodStart('all', NOW)).toBeNull()
    const week = periodStart('7d', NOW) as number
    expect(Math.round((today - week) / 86_400_000)).toBe(6)
  })
})

describe('coste equivalente', () => {
  it('la continuación no suma dos veces el proceso que arrastra', async () => {
    const db = await indexed()
    const origin = conversationCost(db, ORIGIN)
    const points = db
      .prepare<[], { session_id: string; total_usd: number }>(
        'SELECT session_id, max(total_usd) total_usd FROM cost_points WHERE session_id IN (?, ?) GROUP BY session_id'.replace(
          '?, ?',
          `'${ORIGIN}', '${CONTINUATION}'`
        )
      )
      .all()
    const last = Math.max(...points.map((p) => p.total_usd))
    // Misma conversación: el coste es el total final del proceso, no la suma de los dos archivos.
    expect(origin?.usd).toBeCloseTo(last, 6)
    expect(conversationCost(db, CONTINUATION)?.usd).toBeCloseTo(last, 6)
  })

  it('incrementos por proceso atribuidos a la sesión más antigua', () => {
    const row = (
      session_id: string,
      total_usd: number,
      started_at: string
    ): Parameters<typeof costIncrements>[0][number] => ({
      session_id,
      start_time: 1,
      total_usd,
      timestamp: '2026-10-14T10:00:00Z',
      unknown_model: 0,
      started_at,
      project_key: null
    })
    const out = costIncrements([
      row('b', 2.2, '2026-10-02'),
      row('a', 1.4, '2026-10-01'),
      row('b', 1.4, '2026-10-02')
    ])
    expect(out.map((o) => [o.sessionId, Number(o.usd.toFixed(2))])).toEqual([
      ['a', 1.4],
      ['b', 0.8]
    ])
  })

  it('sin coste en alguna sesión, el total es parcial', async () => {
    const db = await indexed()
    const report = usageReport(db, { period: 'all', scope: 'all', projectId: null }, ctx)
    expect(report.cost?.usd).toBeGreaterThan(0)
    if (report.cost && report.cost.missingSessions > 0) expect(report.cost.partial).toBe(true)
    const hidden = usageReport(
      db,
      { period: 'all', scope: 'all', projectId: null },
      { ...ctx, showCost: false }
    )
    expect(hidden.cost).toBeUndefined()
  })
})

describe('indexLimits', () => {
  it('devuelve los avisos aún vigentes', async () => {
    const db = await indexed()
    expect(indexLimits(db, Date.parse('2026-10-14T17:00:00Z')).hits).toEqual([
      {
        timestamp: '2026-10-14T16:39:04.333Z',
        kind: 'five_hour',
        status: 'rejected',
        resetsAt: '2026-10-14T19:30:00.000Z'
      }
    ])
    expect(indexLimits(db, NOW)).toEqual({ hits: [], estimate: null })
  })
})
