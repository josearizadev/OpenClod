import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { describeError, logger as defaultLogger, type Logger } from './logger'

/**
 * Esquema del índice local `bitacora.db`. Si el archivo está corrupto o es
 * de otra versión de esquema, se borra y se crea de nuevo: el índice siempre se puede rehacer a
 * partir de la carpeta de Claude Code.
 */
export const SCHEMA_VERSION = 3

const DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE files (
  path TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  size INTEGER NOT NULL, mtime_ms REAL NOT NULL,
  byte_offset INTEGER NOT NULL, line INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX files_session ON files(session_id);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  folder TEXT NOT NULL,
  file TEXT NOT NULL,
  project_key TEXT,
  start_cwd TEXT,
  title TEXT NOT NULL, title_source TEXT NOT NULL, preview TEXT,
  started_at TEXT, updated_at TEXT, git_branch TEXT,
  models TEXT NOT NULL, cli_versions TEXT NOT NULL,
  message_count INTEGER NOT NULL, prompt_count INTEGER NOT NULL,
  tool_call_count INTEGER NOT NULL, subagent_count INTEGER NOT NULL,
  input INTEGER NOT NULL, output INTEGER NOT NULL, cache_creation INTEGER NOT NULL, cache_read INTEGER NOT NULL,
  own_input INTEGER NOT NULL, own_output INTEGER NOT NULL, own_cache_creation INTEGER NOT NULL, own_cache_read INTEGER NOT NULL,
  conversation_id TEXT NOT NULL, continued_in TEXT, continued_from TEXT, inherited_until_line INTEGER
);
CREATE INDEX sessions_project ON sessions(project_key, updated_at DESC);
CREATE INDEX sessions_conversation ON sessions(conversation_id);

CREATE TABLE session_usage (
  session_id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  agent_id TEXT, model TEXT NOT NULL, timestamp TEXT,
  input INTEGER NOT NULL, output INTEGER NOT NULL, cache_creation INTEGER NOT NULL, cache_read INTEGER NOT NULL,
  PRIMARY KEY (session_id, dedupe_key)
) WITHOUT ROWID;

CREATE TABLE session_lines (
  session_id TEXT NOT NULL, uuid TEXT NOT NULL, line INTEGER NOT NULL,
  PRIMARY KEY (session_id, uuid)
) WITHOUT ROWID;

-- Texto de prompts y respuestas para la búsqueda global.
CREATE TABLE message_text (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  uuid TEXT NOT NULL,
  role TEXT NOT NULL,
  timestamp TEXT,
  line INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX message_text_session ON message_text(session_id);
CREATE VIRTUAL TABLE messages_fts USING fts5(
  text, content='message_text', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER message_text_ai AFTER INSERT ON message_text BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER message_text_ad AFTER DELETE ON message_text BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

-- Avisos de límite y totales de coste de las sesiones.
CREATE TABLE limit_hits (
  session_id TEXT NOT NULL, line INTEGER NOT NULL,
  timestamp TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, resets_at TEXT,
  PRIMARY KEY (session_id, line)
) WITHOUT ROWID;
CREATE TABLE cost_points (
  session_id TEXT NOT NULL, start_time INTEGER NOT NULL, total_usd REAL NOT NULL,
  timestamp TEXT, unknown_model INTEGER NOT NULL,
  PRIMARY KEY (session_id, start_time, total_usd)
) WITHOUT ROWID;
CREATE INDEX session_usage_time ON session_usage(timestamp);

-- Cada mensaje con uso una vez, con su sesión dueña: la que lo contiene sin que lo
-- tenga la sesión de la que continúa (la misma regla que ownUsage); a igualdad, la más antigua.
CREATE VIEW usage_flat AS
  SELECT dedupe_key, session_id, model, timestamp, input, output, cache_creation, cache_read
  FROM (
    SELECT u.dedupe_key, u.session_id, u.model,
           min(u.timestamp) OVER k AS timestamp,
           max(u.input) OVER k AS input, max(u.output) OVER k AS output,
           max(u.cache_creation) OVER k AS cache_creation, max(u.cache_read) OVER k AS cache_read,
           row_number() OVER (PARTITION BY u.dedupe_key ORDER BY
             EXISTS (SELECT 1 FROM session_usage p
                     WHERE p.session_id = s.continued_from AND p.dedupe_key = u.dedupe_key),
             s.started_at, u.session_id) AS rn
    FROM session_usage u JOIN sessions s ON s.session_id = u.session_id
    WINDOW k AS (PARTITION BY u.dedupe_key)
  )
  WHERE rn = 1;

CREATE VIEW usage_events AS
  SELECT dedupe_key, max(input) input, max(output) output,
         max(cache_creation) cache_creation, max(cache_read) cache_read
  FROM session_usage GROUP BY dedupe_key;
`

/** Tablas con datos, en orden de borrado (para `clearIndex`). */
const TABLES = [
  'limit_hits',
  'cost_points',
  'message_text',
  'session_lines',
  'session_usage',
  'sessions',
  'files',
  'meta'
] as const

export type OpenIndexResult =
  | {
      ok: true
      /** Conexión con escritura, en modo WAL. Quien la recibe la cierra. */
      db: Database.Database
      /** Motivo por el que se recreó el archivo, o `null` si se abrió tal cual o es nuevo. */
      recreated: string | null
    }
  | { ok: false; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : describeError(error)
}

function closeQuietly(db: Database.Database | null): void {
  try {
    db?.close()
  } catch {
    // Ya estaba cerrada o no llegó a abrirse.
  }
}

/** Abre en WAL y devuelve `user_version`. better-sqlite3 abre de forma perezosa: un archivo corrupto falla aquí. */
function openWriter(file: string): { db: Database.Database; version: number } {
  const db = new Database(file)
  try {
    db.pragma('journal_mode = WAL')
    const version = db.pragma('user_version', { simple: true }) as number
    return { db, version }
  } catch (error) {
    closeQuietly(db)
    throw error
  }
}

function createSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(DDL)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  })()
}

function removeIndexFiles(file: string): void {
  for (const path of [file, `${file}-wal`, `${file}-shm`]) rmSync(path, { force: true })
}

/**
 * Abre el índice con escritura y comprueba su esquema. Si está corrupto o es de otra
 * versión, borra `bitacora.db`, `-wal` y `-shm` y lo crea vacío, registrando el motivo. Nunca lanza:
 * si ni así se puede crear, devuelve `{ ok: false, error }` y la app sigue sin índice.
 */
export function openIndex(
  file: string,
  log: Pick<Logger, 'info' | 'warn' | 'error'> = defaultLogger
): OpenIndexResult {
  let recreated: string | null = null
  try {
    mkdirSync(dirname(file), { recursive: true })
    const isNew = !existsSync(file)

    let opened: { db: Database.Database; version: number } | null = null
    try {
      opened = openWriter(file)
    } catch (error) {
      recreated = `archivo ilegible (${errorMessage(error)})`
    }

    if (opened && opened.version === 0 && isNew) {
      createSchema(opened.db)
      log.info('index', `Índice creado · esquema ${SCHEMA_VERSION} · ${file}`)
      return { ok: true, db: opened.db, recreated: null }
    }
    if (opened && opened.version === SCHEMA_VERSION) {
      log.info('index', `Índice abierto · esquema ${SCHEMA_VERSION} · ${file}`)
      return { ok: true, db: opened.db, recreated: null }
    }
    if (opened) {
      recreated = `esquema ${opened.version}, se esperaba ${SCHEMA_VERSION}`
      closeQuietly(opened.db)
    }

    log.warn('index', `Se recrea el índice: ${recreated}`)
    removeIndexFiles(file)
    const fresh = openWriter(file)
    try {
      createSchema(fresh.db)
    } catch (error) {
      closeQuietly(fresh.db)
      throw error
    }
    log.info('index', `Índice recreado · esquema ${SCHEMA_VERSION} · ${file}`)
    return { ok: true, db: fresh.db, recreated }
  } catch (error) {
    log.error('index', error)
    return { ok: false, error: errorMessage(error) }
  }
}

/** Conexión de solo lectura para las consultas del main. Lanza si no se puede abrir. */
export function openIndexReader(file: string): Database.Database {
  return new Database(file, { readonly: true, fileMustExist: true })
}

/** Vacía todas las tablas en una transacción, sin borrar el archivo (que el main tiene abierto). */
export function clearIndex(db: Database.Database): void {
  db.transaction(() => {
    for (const table of TABLES) db.exec(`DELETE FROM ${table}`)
  })()
}
