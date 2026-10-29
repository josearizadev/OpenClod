import type Database from 'better-sqlite3'
import { stat } from 'node:fs/promises'
import type { UsageEvent } from '../../shared/sessions'
import { listProjects, type SessionFileRef } from './claude-paths'
import { linkConversations, type SessionFingerprint } from './conversations'
import { clearIndex } from './index-schema'
import { readJsonl, type JsonlChunk } from './jsonl-reader'
import { logger as defaultLogger, type Logger } from './logger'
import { normalizePath, pathKey } from './paths'
import { buildSummary, type SubagentSummaryInput } from './session-loader'
import { PARSER_VERSION, SessionAccumulator } from './session-parser'
import { searchTextOf, type SearchText } from './search-text'
import { UsageLedger } from './usage'

/**
 * Una pasada del índice. Compara tamaño y `mtime` de cada `.jsonl` con la
 * tabla `files`, lee solo lo nuevo restaurando el acumulador guardado, borra lo que ya no
 * está y reenlaza las conversaciones de las carpetas afectadas. Sin dependencias de
 * Electron: recibe la conexión con escritura. Solo lee dentro de la carpeta de Claude Code.
 */

export interface PassResult {
  filesRead: number
  changedSessions: number
  removedSessions: number
  durationMs: number
  /** La carpeta de proyectos no se pudo leer: el índice queda vacío. */
  error?: string
}

type PassLog = Pick<Logger, 'info' | 'warn' | 'error'>

interface FileRow {
  path: string
  session_id: string
  agent_id: string | null
  size: number
  mtime_ms: number
  byte_offset: number
  line: number
  state: string
}

/** Un archivo de la carpeta de Claude Code tal como se ve en esta pasada. */
interface ListedFile {
  path: string
  agentId: string | null
  size: number
  mtimeMs: number
}

interface ListedSession {
  sessionId: string
  folder: string
  main: ListedFile
  subagents: ListedFile[]
}

/** Cómo se lee un archivo: nada (estado guardado), desde el desplazamiento, o entero. */
type ReadMode = 'skip' | 'incremental' | 'full'

/** Resultado de leer (o restaurar) un archivo de una sesión sucia. */
interface FileState {
  file: ListedFile
  acc: SessionAccumulator
  offset: number
  line: number
  /** `uuid` → línea de lo leído en esta pasada (solo archivo principal). */
  lines: Map<string, number>
  /** Texto para la búsqueda de lo leído en esta pasada (solo archivo principal). */
  texts: SearchText[]
  /** Se leyó desde el principio: las líneas guardadas de la sesión ya no valen. */
  full: boolean
  read: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function listSessions(
  claudeDir: string,
  log: PassLog
): Promise<{ ok: true; sessions: ListedSession[] } | { ok: false; error: string }> {
  const listing = await listProjects(claudeDir, log)
  if (!listing.ok) return { ok: false, error: listing.reason }

  const sessions: ListedSession[] = []
  const seen = new Map<string, string>()
  for (const project of listing.projects) {
    for (const ref of project.sessions) {
      const first = seen.get(ref.sessionId)
      if (first) {
        log.warn(
          'index',
          `Sesión ${ref.sessionId} repetida en ${project.name}; se usa la de ${first}`
        )
        continue
      }
      seen.set(ref.sessionId, project.name)
      sessions.push({
        sessionId: ref.sessionId,
        folder: project.name,
        main: { path: ref.file, agentId: null, size: ref.size, mtimeMs: ref.mtimeMs },
        subagents: await statSubagents(ref)
      })
    }
  }
  return { ok: true, sessions }
}

async function statSubagents(ref: SessionFileRef): Promise<ListedFile[]> {
  const out: ListedFile[] = []
  for (const sub of ref.subagents) {
    try {
      const info = await stat(sub.file)
      out.push({ path: sub.file, agentId: sub.agentId, size: info.size, mtimeMs: info.mtimeMs })
    } catch {
      // Borrado entre `readdir` y `stat`: ya no existe.
    }
  }
  return out
}

/** Paso 3: qué hacer con un archivo comparándolo con su fila de `files`. */
function readModeOf(file: ListedFile, row: FileRow | undefined): ReadMode {
  if (!row) return 'full'
  if (file.size === row.size && file.mtimeMs === row.mtime_ms) return 'skip'
  // Solo si creció se puede seguir donde se quedó; si encoge o cambia sin crecer, se relee entero.
  return file.size > row.size && file.size >= row.byte_offset ? 'incremental' : 'full'
}

function restoreFrom(row: FileRow | undefined, agentId: string | null): SessionAccumulator | null {
  if (!row) return null
  let state: unknown
  try {
    state = JSON.parse(row.state)
  } catch {
    return null
  }
  return SessionAccumulator.restore(state, accOptions(agentId))
}

function accOptions(agentId: string | null): { keepItems: false; agentId?: string } {
  return agentId ? { keepItems: false, agentId } : { keepItems: false }
}

function unchanged(file: ListedFile, row: FileRow, acc: SessionAccumulator): FileState {
  return {
    file,
    acc,
    offset: row.byte_offset,
    line: row.line,
    lines: new Map(),
    texts: [],
    full: false,
    read: false
  }
}

/**
 * Lee un archivo según su modo. Si hay un error de E/S, el archivo queda como estaba en el índice
 * (se reintenta en la siguiente pasada); si no estaba, devuelve `null`.
 */
async function loadFile(
  file: ListedFile,
  row: FileRow | undefined,
  mode: ReadMode,
  log: PassLog
): Promise<FileState | null> {
  let acc = mode === 'full' ? null : restoreFrom(row, file.agentId)
  if (mode === 'skip' && acc && row) return unchanged(file, row, acc)

  // Un estado guardado que no se puede restaurar obliga a releer el archivo entero.
  const incremental = mode === 'incremental' && acc !== null && row !== undefined
  const chunk: JsonlChunk = await readJsonl(
    file.path,
    incremental ? { offset: row.byte_offset, line: row.line } : undefined
  )
  if (chunk.error) {
    log.warn('index', `No se pudo leer ${file.path}: ${chunk.error}`)
    const previous = restoreFrom(row, file.agentId)
    return previous && row ? unchanged(file, row, previous) : null
  }
  const full = !incremental || chunk.reset
  if (full || !acc) acc = new SessionAccumulator(accOptions(file.agentId))
  acc.addChunk(chunk)

  const lines = new Map<string, number>()
  const texts: SearchText[] = []
  for (const item of acc.drainItems()) {
    if (file.agentId === null && item.uuid) {
      lines.set(item.uuid, Math.max(lines.get(item.uuid) ?? 0, item.line))
      const text = searchTextOf(item)
      if (text) texts.push(text)
    }
  }
  return { file, acc, offset: chunk.offset, line: chunk.line, lines, texts, full, read: true }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- el tipo de las sentencias se infiere aquí (`Statements`)
function prepareStatements(db: Database.Database) {
  return {
    allFiles: db.prepare<[], FileRow>('SELECT * FROM files'),
    getMeta: db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare<[string, string]>(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    upsertFile: db.prepare(
      `INSERT INTO files (path, session_id, agent_id, size, mtime_ms, byte_offset, line, state)
       VALUES (@path, @session_id, @agent_id, @size, @mtime_ms, @byte_offset, @line, @state)
       ON CONFLICT(path) DO UPDATE SET session_id = excluded.session_id, agent_id = excluded.agent_id,
         size = excluded.size, mtime_ms = excluded.mtime_ms, byte_offset = excluded.byte_offset,
         line = excluded.line, state = excluded.state`
    ),
    deleteFile: db.prepare<[string]>('DELETE FROM files WHERE path = ?'),
    deleteSessionFiles: db.prepare<[string]>('DELETE FROM files WHERE session_id = ?'),
    deleteSession: db.prepare<[string]>('DELETE FROM sessions WHERE session_id = ?'),
    deleteUsage: db.prepare<[string]>('DELETE FROM session_usage WHERE session_id = ?'),
    deleteLines: db.prepare<[string]>('DELETE FROM session_lines WHERE session_id = ?'),
    deleteTexts: db.prepare<[string]>('DELETE FROM message_text WHERE session_id = ?'),
    deleteHits: db.prepare<[string]>('DELETE FROM limit_hits WHERE session_id = ?'),
    deleteCosts: db.prepare<[string]>('DELETE FROM cost_points WHERE session_id = ?'),
    insertHit: db.prepare(
      `INSERT OR REPLACE INTO limit_hits (session_id, line, timestamp, kind, status, resets_at)
       VALUES (@session_id, @line, @timestamp, @kind, @status, @resets_at)`
    ),
    insertCost: db.prepare(
      `INSERT OR REPLACE INTO cost_points (session_id, start_time, total_usd, timestamp, unknown_model)
       VALUES (@session_id, @start_time, @total_usd, @timestamp, @unknown_model)`
    ),
    insertText: db.prepare(
      `INSERT INTO message_text (session_id, uuid, role, timestamp, line, text)
       VALUES (@session_id, @uuid, @role, @timestamp, @line, @text)`
    ),
    sessionFolder: db.prepare<[string], { folder: string }>(
      'SELECT folder FROM sessions WHERE session_id = ?'
    ),
    insertUsage: db.prepare(
      `INSERT INTO session_usage (session_id, dedupe_key, agent_id, model, timestamp,
         input, output, cache_creation, cache_read)
       VALUES (@session_id, @dedupe_key, @agent_id, @model, @timestamp,
         @input, @output, @cache_creation, @cache_read)`
    ),
    insertLine: db.prepare<[string, string, number]>(
      `INSERT INTO session_lines (session_id, uuid, line) VALUES (?, ?, ?)
       ON CONFLICT(session_id, uuid) DO UPDATE SET line = max(line, excluded.line)`
    ),
    upsertSession: db.prepare(
      `INSERT OR REPLACE INTO sessions (session_id, folder, file, project_key, start_cwd, title,
         title_source, preview, started_at, updated_at, git_branch, models, cli_versions,
         message_count, prompt_count, tool_call_count, subagent_count,
         input, output, cache_creation, cache_read,
         own_input, own_output, own_cache_creation, own_cache_read,
         conversation_id, continued_in, continued_from, inherited_until_line)
       VALUES (@session_id, @folder, @file, @project_key, @start_cwd, @title,
         @title_source, @preview, @started_at, @updated_at, @git_branch, @models, @cli_versions,
         @message_count, @prompt_count, @tool_call_count, @subagent_count,
         @input, @output, @cache_creation, @cache_read,
         @input, @output, @cache_creation, @cache_read,
         @session_id, @continued_in, NULL, NULL)`
    ),
    folderSessions: db.prepare<[string], { session_id: string; continued_in: string | null }>(
      'SELECT session_id, continued_in FROM sessions WHERE folder = ?'
    ),
    sessionLines: db.prepare<[string], { uuid: string; line: number }>(
      'SELECT uuid, line FROM session_lines WHERE session_id = ?'
    ),
    sessionUsage: db.prepare<
      [string],
      {
        dedupe_key: string
        agent_id: string | null
        model: string
        timestamp: string | null
        input: number
        output: number
        cache_creation: number
        cache_read: number
      }
    >('SELECT * FROM session_usage WHERE session_id = ?'),
    updateLink: db.prepare(
      `UPDATE sessions SET conversation_id = @conversation_id, continued_from = @continued_from,
         own_input = @own_input, own_output = @own_output,
         own_cache_creation = @own_cache_creation, own_cache_read = @own_cache_read,
         inherited_until_line = @inherited_until_line
       WHERE session_id = @session_id`
    )
  }
}

type Statements = ReturnType<typeof prepareStatements>

/** Paso 5: guarda una sesión sucia con todos sus archivos en una transacción. */
function writeSession(
  db: Database.Database,
  st: Statements,
  session: ListedSession,
  main: FileState,
  subs: FileState[],
  removedSubagents: string[]
): void {
  const ledger = new UsageLedger()
  ledger.add(main.acc.usage)
  const summaryInputs: SubagentSummaryInput[] = []
  for (const sub of subs) {
    ledger.add(sub.acc.usage)
    summaryInputs.push({
      meta: { agentId: sub.file.agentId ?? '' },
      file: sub.file.path,
      stats: sub.acc.stats()
    })
  }
  const stats = main.acc.stats()
  const { summary } = buildSummary(
    { sessionId: session.sessionId, file: session.main.path },
    stats,
    summaryInputs,
    ledger
  )

  db.transaction(() => {
    for (const path of removedSubagents) st.deleteFile.run(path)
    for (const state of [main, ...subs]) {
      if (!state.read) continue
      st.upsertFile.run({
        path: state.file.path,
        session_id: session.sessionId,
        agent_id: state.file.agentId,
        size: state.file.size,
        mtime_ms: state.file.mtimeMs,
        byte_offset: state.offset,
        line: state.line,
        state: JSON.stringify(state.acc.snapshot())
      })
    }

    if (main.full) {
      st.deleteLines.run(session.sessionId)
      st.deleteTexts.run(session.sessionId)
    }
    for (const [uuid, line] of main.lines) st.insertLine.run(session.sessionId, uuid, line)
    for (const t of main.texts) {
      st.insertText.run({
        session_id: session.sessionId,
        uuid: t.uuid,
        role: t.role,
        timestamp: t.timestamp ?? null,
        line: t.line,
        text: t.text
      })
    }

    const usage = summary.usage
    st.upsertSession.run({
      session_id: session.sessionId,
      folder: session.folder,
      file: session.main.path,
      project_key: stats.startCwd ? pathKey(stats.startCwd) : null,
      start_cwd: stats.startCwd ? normalizePath(stats.startCwd) : null,
      title: summary.title,
      title_source: summary.titleSource,
      preview: summary.preview ?? null,
      started_at: summary.startedAt ?? null,
      updated_at: summary.updatedAt ?? null,
      git_branch: summary.gitBranch ?? null,
      models: JSON.stringify(summary.models),
      cli_versions: JSON.stringify(summary.cliVersions),
      message_count: summary.messageCount,
      prompt_count: stats.promptCount,
      tool_call_count: summary.toolCallCount,
      subagent_count: summary.subagents.length,
      input: usage.input,
      output: usage.output,
      cache_creation: usage.cacheCreation,
      cache_read: usage.cacheRead,
      continued_in: summary.continuedIn ?? null
    })

    st.deleteHits.run(session.sessionId)
    for (const hit of main.acc.limitHits) {
      st.insertHit.run({
        session_id: session.sessionId,
        line: hit.line,
        timestamp: hit.timestamp,
        kind: hit.kind,
        status: hit.status,
        resets_at: hit.resetsAt ?? null
      })
    }
    st.deleteCosts.run(session.sessionId)
    for (const point of main.acc.costPoints) {
      st.insertCost.run({
        session_id: session.sessionId,
        start_time: point.startTime,
        total_usd: point.totalUsd,
        timestamp: point.timestamp ?? null,
        unknown_model: point.unknownModel ? 1 : 0
      })
    }

    st.deleteUsage.run(session.sessionId)
    for (const event of ledger.values()) {
      st.insertUsage.run({
        session_id: session.sessionId,
        dedupe_key: event.key,
        agent_id: event.agentId ?? null,
        model: event.model,
        timestamp: event.timestamp ?? null,
        input: event.usage.input,
        output: event.usage.output,
        cache_creation: event.usage.cacheCreation,
        cache_read: event.usage.cacheRead
      })
    }
  })()
}

/** Paso 6: recalcula conversaciones, uso propio y lo heredado de todas las sesiones de una carpeta. */
function relinkFolder(db: Database.Database, st: Statements, folder: string): void {
  const rows = st.folderSessions.all(folder)
  const lineMaps = new Map<string, Map<string, number>>()
  const fingerprints: SessionFingerprint[] = rows.map((row) => {
    const lines = new Map(st.sessionLines.all(row.session_id).map((l) => [l.uuid, l.line]))
    lineMaps.set(row.session_id, lines)
    const usage: UsageEvent[] = st.sessionUsage.all(row.session_id).map((u) => ({
      key: u.dedupe_key,
      model: u.model,
      ...(u.timestamp ? { timestamp: u.timestamp } : {}),
      ...(u.agent_id ? { agentId: u.agent_id } : {}),
      usage: {
        input: u.input,
        output: u.output,
        cacheCreation: u.cache_creation,
        cacheRead: u.cache_read
      }
    }))
    return {
      sessionId: row.session_id,
      ...(row.continued_in ? { continuedIn: row.continued_in } : {}),
      uuids: new Set(lines.keys()),
      usage
    }
  })

  const graph = linkConversations(fingerprints)
  db.transaction(() => {
    for (const [sessionId, link] of graph.links) {
      const lines = lineMaps.get(sessionId)
      let until: number | null = null
      for (const uuid of link.inherited) {
        const line = lines?.get(uuid)
        if (line !== undefined) until = Math.max(until ?? 0, line)
      }
      st.updateLink.run({
        session_id: sessionId,
        conversation_id: link.conversationId,
        continued_from: link.continuedFrom ?? null,
        own_input: link.ownUsage.input,
        own_output: link.ownUsage.output,
        own_cache_creation: link.ownUsage.cacheCreation,
        own_cache_read: link.ownUsage.cacheRead,
        inherited_until_line: until
      })
    }
  })()
}

/** Paso 4: borra una sesión cuyo archivo principal ya no está. */
function removeSession(db: Database.Database, st: Statements, sessionId: string): string | null {
  const folder = st.sessionFolder.get(sessionId)?.folder ?? null
  db.transaction(() => {
    st.deleteSessionFiles.run(sessionId)
    st.deleteLines.run(sessionId)
    st.deleteTexts.run(sessionId)
    st.deleteHits.run(sessionId)
    st.deleteCosts.run(sessionId)
    st.deleteUsage.run(sessionId)
    st.deleteSession.run(sessionId)
  })()
  return folder
}

/** Progreso de una pasada larga: sesiones sucias hechas y totales. */
export type PassProgress = (progress: { done: number; total: number }) => void

/** Solo se informa del progreso con más de estas sesiones sucias (primera construcción). */
const PROGRESS_MIN = 20
const PROGRESS_EVERY = 10

/**
 * Sesiones movidas a otro proyecto desde la app (`sessionId` → carpeta del destino): su proyecto y
 * su carpeta de trabajo pasan a ser los del destino, aunque los `cwd` del archivo sigan siendo los
 * de antes. Devuelve cuántas filas cambiaron.
 */
export function applyMoves(db: Database.Database, moves: Readonly<Record<string, string>>): number {
  const update = db.prepare<[string, string, string, string, string]>(
    `UPDATE sessions SET project_key = ?, start_cwd = ?
     WHERE session_id = ? AND (project_key IS NOT ? OR start_cwd IS NOT ?)`
  )
  let changed = 0
  db.transaction(() => {
    for (const [sessionId, raw] of Object.entries(moves)) {
      const cwd = normalizePath(raw)
      if (!cwd) continue
      const key = pathKey(cwd)
      changed += update.run(key, cwd, sessionId, key, cwd).changes
    }
  })()
  return changed
}

export async function runPass(
  db: Database.Database,
  claudeDir: string,
  log: PassLog = defaultLogger,
  onProgress?: PassProgress,
  moves: Readonly<Record<string, string>> = {}
): Promise<PassResult> {
  const started = performance.now()
  const st = prepareStatements(db)
  const result: PassResult = { filesRead: 0, changedSessions: 0, removedSessions: 0, durationMs: 0 }

  // 1. Otra carpeta de Claude Code u otra versión del parser: lo guardado no vale.
  const storedDir = st.getMeta.get('claude_dir')?.value
  const storedParser = st.getMeta.get('parser_version')?.value
  if (storedDir !== claudeDir || storedParser !== String(PARSER_VERSION)) {
    if (storedDir !== undefined || storedParser !== undefined) {
      log.info(
        'index',
        'Cambió la carpeta de Claude Code o la versión del parser: se vacía el índice'
      )
    }
    clearIndex(db)
    db.transaction(() => {
      st.setMeta.run('claude_dir', claudeDir)
      st.setMeta.run('parser_version', String(PARSER_VERSION))
    })()
  }

  // 2. Lista de archivos. Si la carpeta no se puede leer, el índice queda vacío.
  const listing = await listSessions(claudeDir, log)
  const sessions = listing.ok ? listing.sessions : []
  if (!listing.ok) result.error = listing.error

  const rows = new Map(st.allFiles.all().map((row) => [row.path, row]))
  const affectedFolders = new Set<string>()

  // 4. Lo que ya no está: archivos principales (sesión entera) y subagentes (sesión sucia).
  const present = new Set<string>()
  for (const session of sessions) {
    present.add(session.main.path)
    for (const sub of session.subagents) present.add(sub.path)
  }
  const removedSubagents = new Map<string, string[]>()
  for (const row of rows.values()) {
    if (present.has(row.path)) continue
    if (row.agent_id === null) {
      const folder = removeSession(db, st, row.session_id)
      if (folder) affectedFolders.add(folder)
      result.removedSessions += 1
    } else {
      const list = removedSubagents.get(row.session_id) ?? []
      list.push(row.path)
      removedSubagents.set(row.session_id, list)
    }
  }

  // 3 y 5. Leer lo nuevo y guardar cada sesión sucia en su transacción.
  const dirty = sessions.flatMap((session) => {
    const files = [session.main, ...session.subagents]
    const modes = files.map((file) => readModeOf(file, rows.get(file.path)))
    const gone = removedSubagents.get(session.sessionId) ?? []
    return gone.length === 0 && modes.every((mode) => mode === 'skip')
      ? []
      : [{ session, files, modes, gone }]
  })
  const report = onProgress && dirty.length > PROGRESS_MIN ? onProgress : null
  report?.({ done: 0, total: dirty.length })
  for (const [done, { session, files, modes, gone }] of dirty.entries()) {
    if (done > 0 && done % PROGRESS_EVERY === 0) report?.({ done, total: dirty.length })

    const states: (FileState | null)[] = []
    for (const [index, file] of files.entries()) {
      const state = await loadFile(file, rows.get(file.path), modes[index] ?? 'full', log)
      if (state?.read) result.filesRead += 1
      states.push(state)
    }
    const [main, ...subs] = states
    // Sin archivo principal legible no se puede resumir: se reintenta en la siguiente pasada.
    if (!main) continue
    try {
      writeSession(
        db,
        st,
        session,
        main,
        subs.filter((s): s is FileState => s !== null),
        gone
      )
      result.changedSessions += 1
      affectedFolders.add(session.folder)
    } catch (error) {
      log.error(
        'index',
        `No se pudo guardar la sesión ${session.sessionId}: ${errorMessage(error)}`
      )
    }
  }

  // 6. Reenlazar conversaciones donde algo cambió y aplicar las sesiones movidas.
  for (const folder of affectedFolders) relinkFolder(db, st, folder)
  result.changedSessions += applyMoves(db, moves)

  // 7. Resumen de la pasada.
  result.durationMs = Math.round(performance.now() - started)
  st.setMeta.run(
    'last_pass',
    JSON.stringify({
      finishedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      filesRead: result.filesRead,
      changedSessions: result.changedSessions,
      removedSessions: result.removedSessions
    })
  )
  return result
}
