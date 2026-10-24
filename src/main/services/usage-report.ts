import type Database from 'better-sqlite3'
import { basename } from 'node:path'
import { EMPTY_USAGE, type TokenUsage } from '../../shared/sessions'
import type { Project, SessionMeta } from '../../shared/types'
import type { CostTotal, UsageDay, UsageQuery, UsageReport } from '../../shared/usage'
import { IS_ENTRY } from './index-queries'
import { pathKey } from './paths'
import type { IndexLimits } from './limits'
import { addUsage } from './usage'
import {
  ccusageBlocks,
  currentBlockInfo,
  tokensOf,
  type BlockAlgorithm,
  type BlockEvent
} from './usage-blocks'
import { t } from '../i18n'

/**
 * Informe de uso. Lee el periodo (y al menos 30 días para los bloques) en
 * una consulta por tabla y agrupa en JS: día local, proyecto, modelo y conversación.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface UsageReportContext {
  projects: readonly Project[]
  sessionMeta: Readonly<Record<string, SessionMeta>>
  showCost: boolean
  now?: number
  algorithm?: BlockAlgorithm
}

interface EventRow {
  session_id: string
  model: string
  timestamp: string | null
  input: number
  output: number
  cache_creation: number
  cache_read: number
  project_key: string | null
  start_cwd: string | null
  folder: string
  conversation_id: string
}

interface CostRow {
  session_id: string
  start_time: number
  total_usd: number
  timestamp: string | null
  unknown_model: number
  started_at: string | null
  project_key: string | null
}

const EVENTS_SQL = `
SELECT f.session_id, f.model, f.timestamp, f.input, f.output, f.cache_creation, f.cache_read,
       s.project_key, s.start_cwd, s.folder, s.conversation_id
FROM usage_flat f JOIN sessions s ON s.session_id = f.session_id
WHERE f.timestamp IS NOT NULL AND (@from IS NULL OR f.timestamp >= @from)`

const COSTS_SQL = `
SELECT c.session_id, c.start_time, c.total_usd, c.timestamp, c.unknown_model,
       s.started_at, s.project_key
FROM cost_points c JOIN sessions s ON s.session_id = c.session_id`

/** YYYY-MM-DD en la zona horaria local. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Inicio del periodo (medianoche local), o `null` para «Todo». */
export function periodStart(period: UsageQuery['period'], now: number): number | null {
  const today = startOfLocalDay(now)
  if (period === 'today') return today
  if (period === 'all') return null
  const days = period === '7d' ? 6 : 29
  const d = new Date(today)
  d.setDate(d.getDate() - days)
  return d.getTime()
}

function usageOf(row: EventRow): TokenUsage {
  return {
    input: row.input,
    output: row.output,
    cacheCreation: row.cache_creation,
    cacheRead: row.cache_read
  }
}

/**
 * Incrementos de coste: por proceso (`start_time`), los totales distintos de todas
 * las sesiones en orden; cada incremento va a la sesión más antigua donde aparece ese total.
 */
export function costIncrements(rows: readonly CostRow[]): {
  sessionId: string
  t: number | null
  usd: number
  unknown: boolean
  projectKey: string | null
}[] {
  const byProcess = new Map<number, CostRow[]>()
  for (const row of rows) {
    const list = byProcess.get(row.start_time) ?? []
    list.push(row)
    byProcess.set(row.start_time, list)
  }
  const out: ReturnType<typeof costIncrements> = []
  for (const list of byProcess.values()) {
    const owners = new Map<number, CostRow>()
    for (const row of list) {
      const owner = owners.get(row.total_usd)
      if (!owner || (row.started_at ?? '~') < (owner.started_at ?? '~'))
        owners.set(row.total_usd, row)
    }
    let previous = 0
    for (const total of [...owners.keys()].sort((a, b) => a - b)) {
      const row = owners.get(total) as CostRow
      const t = row.timestamp ? Date.parse(row.timestamp) : NaN
      out.push({
        sessionId: row.session_id,
        t: Number.isFinite(t) ? t : null,
        usd: total - previous,
        unknown: row.unknown_model === 1,
        projectKey: row.project_key
      })
      previous = total
    }
  }
  return out
}

function emptyCost(): CostTotal {
  return { usd: 0, partial: false, missingSessions: 0 }
}

export function usageReport(
  db: Database.Database,
  query: UsageQuery,
  ctx: UsageReportContext
): UsageReport {
  const started = performance.now()
  const now = ctx.now ?? Date.now()
  const from = periodStart(query.period, now)
  const blocksFrom = Math.min(from ?? 0, now - 31 * DAY_MS)
  const project =
    query.scope === 'project' ? ctx.projects.find((p) => p.id === query.projectId) : undefined
  const scopeKey = query.scope === 'project' ? (project ? pathKey(project.path) : '\0') : null
  const projectsByKey = new Map(ctx.projects.map((p) => [pathKey(p.path), p]))

  const rows = db
    .prepare<{ from: string | null }, EventRow>(EVENTS_SQL)
    .all({ from: query.period === 'all' ? null : new Date(blocksFrom).toISOString() })

  // Bloques: globales, con todos los mensajes leídos.
  const blockEvents: BlockEvent[] = []
  const hits = db
    .prepare<{ from: string }, { timestamp: string; resets_at: string | null }>(
      'SELECT DISTINCT timestamp, resets_at FROM limit_hits WHERE timestamp >= @from'
    )
    .all({ from: new Date(query.period === 'all' ? 0 : blocksFrom).toISOString() })
    .map((h) => {
      const r = h.resets_at ? Date.parse(h.resets_at) : NaN
      return { t: Date.parse(h.timestamp), ...(Number.isFinite(r) ? { resetsAt: r } : {}) }
    })

  let totals: TokenUsage = { ...EMPTY_USAGE }
  let messages = 0
  const sessions = new Set<string>()
  const days = new Map<string, UsageDay>()
  const byProject = new Map<string, UsageReport['byProject'][number]>()
  const byModel = new Map<string, UsageReport['byModel'][number]>()
  const byConversation = new Map<
    string,
    { tokens: number; projectName: string; sessions: Set<string> }
  >()

  for (const row of rows) {
    const t = Date.parse(row.timestamp as string)
    if (!Number.isFinite(t)) continue
    const usage = usageOf(row)
    blockEvents.push({ t, usage, model: row.model })
    if (from !== null && t < from) continue
    const key = row.project_key ?? `carpeta:${row.folder}`
    if (scopeKey !== null && row.project_key !== scopeKey) continue
    const tokens = tokensOf(usage)
    totals = addUsage(totals, usage)
    messages += 1
    sessions.add(row.session_id)

    const day = dayKey(t)
    const d = days.get(day) ?? { day, byModel: {}, total: 0 }
    d.byModel[row.model] = (d.byModel[row.model] ?? 0) + tokens
    d.total += tokens
    days.set(day, d)

    const imported = row.project_key ? projectsByKey.get(row.project_key) : undefined
    const name = imported?.name ?? (row.start_cwd ? basename(row.start_cwd) : row.folder)
    const p = byProject.get(key) ?? {
      key,
      name,
      imported: Boolean(imported),
      ...(imported ? { projectId: imported.id } : {}),
      tokens: 0,
      messages: 0
    }
    p.tokens += tokens
    p.messages += 1
    byProject.set(key, p)

    const m = byModel.get(row.model) ?? {
      model: row.model,
      usage: { ...EMPTY_USAGE },
      tokens: 0,
      messages: 0
    }
    m.usage = addUsage(m.usage, usage)
    m.tokens += tokens
    m.messages += 1
    byModel.set(row.model, m)

    const c = byConversation.get(row.conversation_id) ?? {
      tokens: 0,
      projectName: name,
      sessions: new Set()
    }
    c.tokens += tokens
    c.sessions.add(row.session_id)
    byConversation.set(row.conversation_id, c)
  }

  // Días sin uso dentro del rango, para que la gráfica no salte huecos.
  const firstDay =
    from ??
    (days.size ? Math.min(...[...days.keys()].map((k) => Date.parse(`${k}T00:00:00`))) : now)
  for (
    let d = new Date(startOfLocalDay(firstDay));
    d.getTime() <= now;
    d.setDate(d.getDate() + 1)
  ) {
    const key = dayKey(d.getTime())
    if (!days.has(key)) days.set(key, { day: key, byModel: {}, total: 0 })
  }

  const entries = new Map(
    db
      .prepare<
        [],
        { session_id: string; conversation_id: string; title: string; updated_at: string | null }
      >(
        `SELECT s.session_id, s.conversation_id, s.title, s.updated_at FROM sessions s WHERE ${IS_ENTRY}`
      )
      .all()
      .map((e) => [e.conversation_id, e])
  )

  let cost: CostTotal | undefined
  const costBySession = new Map<string, number>()
  if (ctx.showCost) {
    cost = emptyCost()
    const withCost = new Set<string>()
    for (const inc of costIncrements(db.prepare<[], CostRow>(COSTS_SQL).all())) {
      withCost.add(inc.sessionId)
      if (from !== null && (inc.t === null || inc.t < from)) continue
      if (scopeKey !== null && inc.projectKey !== scopeKey) continue
      cost.usd += inc.usd
      if (inc.unknown) cost.partial = true
      costBySession.set(inc.sessionId, (costBySession.get(inc.sessionId) ?? 0) + inc.usd)
    }
    for (const id of sessions) if (!withCost.has(id)) cost.missingSessions += 1
    if (cost.missingSessions > 0) cost.partial = true
  }

  const topSessions = [...byConversation.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 10)
    .map(([conversationId, c]) => {
      const entry = entries.get(conversationId)
      const sessionId = entry?.session_id ?? [...c.sessions][0] ?? conversationId
      const usd = ctx.showCost
        ? [...c.sessions].reduce((sum, id) => sum + (costBySession.get(id) ?? 0), 0)
        : undefined
      return {
        sessionId,
        title: ctx.sessionMeta[conversationId]?.title ?? entry?.title ?? t('(sin título)'),
        projectName: c.projectName,
        tokens: c.tokens,
        ...(entry?.updated_at ? { updatedAt: entry.updated_at } : {}),
        ...(usd !== undefined ? { cost: { usd, partial: false, missingSessions: 0 } } : {})
      }
    })

  const algorithm = ctx.algorithm ?? ccusageBlocks
  const allBlocks = algorithm.blocks(blockEvents, hits, now)
  const current = currentBlockInfo(allBlocks, blockEvents, now)
  const blocks = allBlocks.filter((b) => from === null || Date.parse(b.end) > from).reverse()

  return {
    range: {
      from: from === null ? null : new Date(from).toISOString(),
      to: new Date(now).toISOString()
    },
    totals: { usage: totals, tokens: tokensOf(totals), messages, sessions: sessions.size },
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProject: [...byProject.values()].sort((a, b) => b.tokens - a.tokens),
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    topSessions,
    blocks,
    current,
    ...(cost ? { cost } : {}),
    tookMs: Math.round(performance.now() - started)
  }
}

/**
 * Lo que el `LimitsService` necesita del índice: avisos de límite aún vigentes y el
 * bloque activo estimado (con 2 días de mensajes basta para encadenar los bloques recientes).
 */
export function indexLimits(
  db: Database.Database,
  now = Date.now(),
  algorithm: BlockAlgorithm = ccusageBlocks
): IndexLimits {
  const since = new Date(now - 2 * DAY_MS).toISOString()
  const hits = db
    .prepare<
      { now: string },
      { timestamp: string; kind: string; status: string; resets_at: string | null }
    >(
      `SELECT DISTINCT timestamp, kind, status, resets_at FROM limit_hits
       WHERE resets_at > @now ORDER BY timestamp`
    )
    .all({ now: new Date(now).toISOString() })
  const events: BlockEvent[] = db
    .prepare<
      { since: string },
      { t: string; model: string } & Omit<
        EventRow,
        | 'session_id'
        | 'model'
        | 'timestamp'
        | 'project_key'
        | 'start_cwd'
        | 'folder'
        | 'conversation_id'
      >
    >(
      `SELECT timestamp AS t, model, input, output, cache_creation, cache_read
       FROM usage_flat WHERE timestamp >= @since`
    )
    .all({ since })
    .map((r) => ({
      t: Date.parse(r.t),
      model: r.model,
      usage: {
        input: r.input,
        output: r.output,
        cacheCreation: r.cache_creation,
        cacheRead: r.cache_read
      }
    }))
    .filter((e) => Number.isFinite(e.t))
  const anchors = hits.flatMap((h) => {
    const r = h.resets_at ? Date.parse(h.resets_at) : NaN
    return Number.isFinite(r) ? [{ t: Date.parse(h.timestamp), resetsAt: r }] : []
  })
  const active = algorithm.blocks(events, anchors, now).find((b) => b.active)
  return {
    hits: hits.map((h) => ({
      timestamp: h.timestamp,
      kind: h.kind as IndexLimits['hits'][number]['kind'],
      status: h.status,
      resetsAt: h.resets_at
    })),
    estimate: active ? { start: active.start, end: active.end, tokens: active.tokens } : null
  }
}

/**
 * Coste equivalente de una conversación: incrementos atribuidos a sus sesiones. `null`
 * si ninguna tiene `cost-state`.
 */
export function conversationCost(db: Database.Database, sessionId: string): CostTotal | null {
  const ids = new Set(
    db
      .prepare<[string], { session_id: string }>(
        `SELECT session_id FROM sessions WHERE conversation_id =
           (SELECT conversation_id FROM sessions WHERE session_id = ?)`
      )
      .all(sessionId)
      .map((r) => r.session_id)
  )
  if (ids.size === 0) return null
  const cost = emptyCost()
  const withCost = new Set<string>()
  for (const inc of costIncrements(db.prepare<[], CostRow>(COSTS_SQL).all())) {
    if (!ids.has(inc.sessionId)) continue
    withCost.add(inc.sessionId)
    cost.usd += inc.usd
    if (inc.unknown) cost.partial = true
  }
  if (withCost.size === 0) return null
  cost.missingSessions = ids.size - withCost.size
  if (cost.missingSessions > 0) cost.partial = true
  return cost
}
