import type Database from 'better-sqlite3'
import type {
  DiscoveredProject,
  IndexStatus,
  LastPass,
  SessionDetail,
  SessionListItem
} from '../../shared/projects'
import { LastPassSchema, TitleSourceSchema } from '../../shared/projects'
import type { TokenUsage } from '../../shared/sessions'
import { SCHEMA_VERSION } from './index-schema'

/**
 * Consultas de solo lectura sobre el índice. Las usa el main con la
 * conexión `readonly` mientras el worker escribe (WAL).
 *
 * Una sesión es **visible** si tiene algún prompt real o alguna respuesta del asistente (uso
 * registrado): así se ocultan las vacías y las de solo `/clear`, `/model`… pero no las que
 * empiezan con un comando personalizado que Claude sí atendió.
 *
 * Una **entrada** de la lista es una sesión visible que no tiene una continuación indexada en su
 * misma conversación: la última de la cadena, o una cuyo `continued-in` apunta a una sesión que
 * no está (enlace roto).
 */
const IS_VISIBLE = `(s.prompt_count > 0 OR EXISTS (
  SELECT 1 FROM session_usage u WHERE u.session_id = s.session_id))`

export const IS_ENTRY = `${IS_VISIBLE} AND (s.continued_in IS NULL OR NOT EXISTS (
  SELECT 1 FROM sessions t
  WHERE t.session_id = s.continued_in AND t.conversation_id = s.conversation_id))`

/** `mtime` más reciente de los archivos de la sesión (principal y subagentes). */
const LAST_WRITE = `(SELECT max(f.mtime_ms) FROM files f WHERE f.session_id = s.session_id) last_write`

/** Agregado de cada conversación: inicio de la primera, uso propio sumado y longitud. */
const CHAINS = `SELECT conversation_id, min(started_at) started_at,
  sum(own_input) input, sum(own_output) output,
  sum(own_cache_creation) cache_creation, sum(own_cache_read) cache_read,
  count(*) chain_length
FROM sessions`

/**
 * Entrada de la lista tal como sale del índice: sin los datos propios (favorita, oculta), que
 * aplica `ProjectsService` a partir de `conversationId`.
 */
export type IndexedListItem = Omit<SessionListItem, 'favorite' | 'hidden'> & {
  conversationId: string
}
export type IndexedDetail = Omit<SessionDetail, 'favorite' | 'hidden'> & {
  conversationId: string
}

interface EntryRow {
  session_id: string
  conversation_id: string
  title: string
  updated_at: string | null
  git_branch: string | null
  started_at: string | null
  input: number
  output: number
  cache_creation: number
  cache_read: number
  chain_length: number
  last_write: number | null
}

interface SessionRow {
  session_id: string
  conversation_id: string
  title: string
  title_source: string
  started_at: string | null
  updated_at: string | null
  git_branch: string | null
  start_cwd: string | null
  models: string
  message_count: number
  tool_call_count: number
  subagent_count: number
  own_input: number
  own_output: number
  own_cache_creation: number
  own_cache_read: number
  continued_from: string | null
  last_write: number | null
}

function usageOf(row: {
  input: number
  output: number
  cache_creation: number
  cache_read: number
}): TokenUsage {
  return {
    input: row.input,
    output: row.output,
    cacheCreation: row.cache_creation,
    cacheRead: row.cache_read
  }
}

function toListItem(row: EntryRow): IndexedListItem {
  return {
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    title: row.title,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    ...(row.git_branch ? { gitBranch: row.git_branch } : {}),
    usage: usageOf(row),
    chainLength: row.chain_length,
    ...(row.last_write !== null ? { lastWriteAt: Math.round(row.last_write) } : {})
  }
}

function parseStrings(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Sesiones del proyecto, de la más reciente a la más antigua, una por conversación. */
export function listSessions(db: Database.Database, projectKey: string): IndexedListItem[] {
  const rows = db
    .prepare<[string, string], EntryRow>(
      `SELECT s.session_id, s.conversation_id, s.title, s.updated_at, s.git_branch,
         c.started_at, c.input, c.output, c.cache_creation, c.cache_read, c.chain_length,
         ${LAST_WRITE}
       FROM sessions s
       JOIN (${CHAINS} WHERE conversation_id IN (
         SELECT conversation_id FROM sessions WHERE project_key = ?) GROUP BY conversation_id) c
         ON c.conversation_id = s.conversation_id
       WHERE s.project_key = ? AND ${IS_ENTRY}
       ORDER BY s.updated_at DESC, s.session_id`
    )
    .all(projectKey, projectKey)
  return rows.map(toListItem)
}

interface ChainRow {
  session_id: string
  continued_from: string | null
  started_at: string | null
  input: number
  output: number
  cache_creation: number
  cache_read: number
}

/**
 * Ordena la cadena siguiendo `continued_from`: la continuación copia las primeras líneas de la
 * anterior y suele tener su misma fecha de inicio, así que la fecha no basta.
 */
export function orderChain<T extends { session_id: string; continued_from: string | null }>(
  rows: T[]
): T[] {
  const ids = new Set(rows.map((r) => r.session_id))
  const next = new Map<string, T>()
  for (const r of rows) {
    if (r.continued_from && ids.has(r.continued_from)) next.set(r.continued_from, r)
  }
  const out: T[] = []
  const seen = new Set<string>()
  for (const head of rows.filter((r) => !r.continued_from || !ids.has(r.continued_from))) {
    for (let cur: T | undefined = head; cur && !seen.has(cur.session_id);) {
      seen.add(cur.session_id)
      out.push(cur)
      cur = next.get(cur.session_id)
    }
  }
  // Un ciclo (no debería darse) deja filas sin visitar: van al final, por fecha.
  for (const r of rows) if (!seen.has(r.session_id)) out.push(r)
  return out
}

/** Ficha de una sesión con los datos de su conversación, o `null` si no está indexada. */
export function getSession(db: Database.Database, sessionId: string): IndexedDetail | null {
  const row = db
    .prepare<[string], SessionRow>(`SELECT s.*, ${LAST_WRITE} FROM sessions s WHERE session_id = ?`)
    .get(sessionId)
  if (!row) return null

  const chainRows = orderChain(
    db
      .prepare<[string], ChainRow>(
        `SELECT session_id, continued_from, started_at,
           own_input input, own_output output, own_cache_creation cache_creation,
           own_cache_read cache_read
         FROM sessions WHERE conversation_id = ?
         ORDER BY started_at IS NULL, started_at, session_id`
      )
      .all(row.conversation_id)
  )
  const usage: TokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
  let startedAt: string | null = null
  for (const link of chainRows) {
    usage.input += link.input
    usage.output += link.output
    usage.cacheCreation += link.cache_creation
    usage.cacheRead += link.cache_read
    if (link.started_at && (startedAt === null || link.started_at < startedAt)) {
      startedAt = link.started_at
    }
  }

  const titleSource = TitleSourceSchema.safeParse(row.title_source)
  return {
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    title: row.title,
    ...(startedAt ? { startedAt } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    ...(row.git_branch ? { gitBranch: row.git_branch } : {}),
    usage,
    chainLength: chainRows.length,
    ...(row.last_write !== null ? { lastWriteAt: Math.round(row.last_write) } : {}),
    titleSource: titleSource.success ? titleSource.data : 'none',
    models: parseStrings(row.models),
    messageCount: row.message_count,
    toolCallCount: row.tool_call_count,
    subagentCount: row.subagent_count,
    ownUsage: {
      input: row.own_input,
      output: row.own_output,
      cacheCreation: row.own_cache_creation,
      cacheRead: row.own_cache_read
    },
    ...(row.start_cwd ? { cwd: row.start_cwd } : {}),
    ...(row.continued_from ? { continuedFrom: row.continued_from } : {}),
    chain: chainRows.map((r) => r.session_id)
  }
}

/** Cuántas de `conversationIds` tienen alguna sesión en el índice. */
export function countIndexedConversations(
  db: Database.Database,
  conversationIds: readonly string[]
): number {
  if (conversationIds.length === 0) return 0
  return (
    db
      .prepare<[string], number>(
        `SELECT count(DISTINCT conversation_id) FROM sessions
         WHERE conversation_id IN (SELECT value FROM json_each(?))`
      )
      .pluck()
      .get(JSON.stringify(conversationIds)) ?? 0
  )
}

/** `conversation_id` de una sesión, o `null` si no está indexada. */
export function conversationOf(db: Database.Database, sessionId: string): string | null {
  return (
    db
      .prepare<[string], string>('SELECT conversation_id FROM sessions WHERE session_id = ?')
      .pluck()
      .get(sessionId) ?? null
  )
}

export interface ProjectStats {
  sessionCount: number
  lastActivityAt: string | null
}

/** Nº de entradas de lista y última actividad de cada clave de proyecto. */
export function projectStats(
  db: Database.Database,
  keys: readonly string[]
): Map<string, ProjectStats> {
  const out = new Map<string, ProjectStats>()
  if (keys.length === 0) return out
  const rows = db
    .prepare<
      [string],
      { project_key: string; session_count: number; last_activity: string | null }
    >(
      `SELECT s.project_key, count(*) session_count, max(s.updated_at) last_activity
       FROM sessions s
       WHERE s.project_key IN (SELECT value FROM json_each(?)) AND ${IS_ENTRY}
       GROUP BY s.project_key`
    )
    .all(JSON.stringify(keys))
  for (const row of rows) {
    out.set(row.project_key, {
      sessionCount: row.session_count,
      lastActivityAt: row.last_activity
    })
  }
  return out
}

/**
 * Carpetas de trabajo con sesiones que no son proyectos, por actividad reciente. La ruta
 * es el primer `cwd` de la sesión más reciente de cada clave.
 */
export function discover(
  db: Database.Database,
  excludeKeys: readonly string[]
): DiscoveredProject[] {
  const rows = db
    .prepare<[string], { start_cwd: string; session_count: number; last_activity: string | null }>(
      // Con `max()`, SQLite toma las columnas sueltas (`start_cwd`) de la fila del máximo.
      `SELECT s.start_cwd, count(*) session_count, max(s.updated_at) last_activity
       FROM sessions s
       WHERE s.project_key IS NOT NULL AND s.start_cwd IS NOT NULL
         AND s.project_key NOT IN (SELECT value FROM json_each(?)) AND ${IS_ENTRY}
       GROUP BY s.project_key
       ORDER BY last_activity IS NULL, last_activity DESC, s.start_cwd`
    )
    .all(JSON.stringify(excludeKeys))
  return rows.map((row) => ({
    path: row.start_cwd,
    sessionCount: row.session_count,
    lastActivityAt: row.last_activity
  }))
}

function lastPassOf(db: Database.Database): LastPass | undefined {
  const value = db
    .prepare<[], string>("SELECT value FROM meta WHERE key = 'last_pass'")
    .pluck()
    .get()
  if (!value) return undefined
  try {
    const parsed = LastPassSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Recuentos del índice para Diagnóstico. */
export function indexStatus(
  db: Database.Database,
  context: { path: string; running: boolean }
): IndexStatus {
  const count = (sql: string): number => db.prepare<[], number>(sql).pluck().get() ?? 0
  const lastPass = lastPassOf(db)
  const usage = db
    .prepare<[], TokenUsage>(
      `SELECT coalesce(sum(input), 0) input, coalesce(sum(output), 0) output,
         coalesce(sum(cache_creation), 0) cacheCreation, coalesce(sum(cache_read), 0) cacheRead
       FROM usage_events`
    )
    .get() ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
  return {
    path: context.path,
    ok: true,
    sqliteVersion: db.prepare<[], string>('SELECT sqlite_version()').pluck().get() ?? '',
    schemaVersion: SCHEMA_VERSION,
    files: count('SELECT count(*) FROM files'),
    sessions: count('SELECT count(*) FROM sessions'),
    usageEvents: count('SELECT count(*) FROM usage_events'),
    usage,
    hiddenSessions: count(`SELECT count(*) FROM sessions s WHERE NOT ${IS_VISIBLE}`),
    running: context.running,
    ...(lastPass ? { lastPass } : {}),
    search: { messages: count('SELECT count(*) FROM message_text') }
  }
}
