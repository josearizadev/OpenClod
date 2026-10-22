import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  clearIndex,
  openIndex,
  openIndexReader,
  SCHEMA_VERSION
} from '../../src/main/services/index-schema'

const dirs: string[] = []
const connections: Database.Database[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bitacora-index-'))
  dirs.push(dir)
  return join(dir, 'bitacora.db')
}

type MockLog = Record<'info' | 'warn' | 'error', Mock<(scope: string, message: unknown) => void>>

function silentLog(): MockLog {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function open(file: string, log = silentLog()): Database.Database {
  const result = openIndex(file, log)
  if (!result.ok) throw new Error(result.error)
  connections.push(result.db)
  return result.db
}

function tableNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
    .pluck()
    .all() as string[]
}

function insertSample(db: Database.Database): void {
  db.prepare("INSERT INTO meta (key, value) VALUES ('claude_dir', 'C:\\x')").run()
  db.prepare(
    `INSERT INTO session_usage (session_id, dedupe_key, model, input, output, cache_creation, cache_read)
     VALUES ('s1', 'k1', 'm', 10, 1, 0, 0), ('s2', 'k1', 'm', 12, 1, 0, 0), ('s2', 'k2', 'm', 5, 2, 0, 0)`
  ).run()
}

afterEach(() => {
  // En Windows un archivo abierto no se puede borrar: primero se cierran las conexiones.
  for (const db of connections.splice(0)) if (db.open) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('openIndex', () => {
  it('crea el esquema (y la carpeta) en modo WAL con user_version', () => {
    const file = join(tempFile(), '..', 'sub', 'bitacora.db')
    const log = silentLog()
    const db = open(file, log)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(tableNames(db)).toEqual([
      'cost_points',
      'files',
      'limit_hits',
      'message_text',
      'messages_fts',
      'messages_fts_config',
      'messages_fts_data',
      'messages_fts_docsize',
      'messages_fts_idx',
      'meta',
      'session_lines',
      'session_usage',
      'sessions',
      'usage_events',
      'usage_flat'
    ])
    expect(log.info).toHaveBeenCalledWith('index', expect.stringMatching(/creado/))
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('reabre sin cambios un índice existente y conserva sus datos', () => {
    const file = tempFile()
    const db = open(file)
    insertSample(db)
    db.close()
    const log = silentLog()
    const result = openIndex(file, log)
    expect(result.ok && result.recreated).toBeNull()
    if (!result.ok) return
    connections.push(result.db)
    expect(result.db.prepare('SELECT count(*) FROM session_usage').pluck().get()).toBe(3)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('con bytes aleatorios borra el archivo, lo recrea y registra el motivo', () => {
    const file = tempFile()
    writeFileSync(file, randomBytes(8192))
    writeFileSync(`${file}-wal`, randomBytes(512))
    const log = silentLog()
    const result = openIndex(file, log)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    connections.push(result.db)
    expect(result.recreated).toMatch(/ilegible/)
    expect(log.warn).toHaveBeenCalledWith('index', expect.stringMatching(/recrea/))
    expect(result.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(result.db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(0)
  })

  it('con un user_version antiguo recrea el índice vacío', () => {
    const file = tempFile()
    const db = open(file)
    insertSample(db)
    db.pragma('user_version = 0')
    db.exec('CREATE TABLE vieja (x)')
    db.close()
    const result = openIndex(file, silentLog())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    connections.push(result.db)
    expect(result.recreated).toMatch(/esquema 0/)
    expect(tableNames(result.db)).not.toContain('vieja')
    expect(result.db.prepare('SELECT count(*) FROM session_usage').pluck().get()).toBe(0)
  })

  it('v1 → v2: recrea con la tabla FTS5 de búsqueda', () => {
    const file = tempFile()
    const db = open(file)
    db.pragma('user_version = 1')
    db.close()
    const result = openIndex(file, silentLog())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    connections.push(result.db)
    expect(result.recreated).toMatch(/esquema 1/)
    const fts = result.db
    fts
      .prepare(
        `INSERT INTO message_text (session_id, uuid, role, line, text) VALUES ('s', 'u', 'user', 1, ?)`
      )
      .run('La búsqueda del índice')
    const match = (q: string): number =>
      fts
        .prepare<[string], number>('SELECT count(*) FROM messages_fts WHERE messages_fts MATCH ?')
        .pluck()
        .get(q) ?? 0
    expect(match('busqueda')).toBe(1)
    expect(match('"indi"*')).toBe(1)
    fts.exec(`DELETE FROM message_text`)
    expect(match('busqueda')).toBe(0)
  })

  it('si no se puede crear devuelve el error sin lanzar', () => {
    const file = tempFile()
    mkdirSync(file)
    const log = silentLog()
    const result = openIndex(file, log)
    expect(result.ok).toBe(false)
    expect(log.error).toHaveBeenCalledOnce()
    expect(existsSync(file)).toBe(true)
  })
})

describe('openIndexReader', () => {
  it('lee en solo lectura, también con el escritor abierto o ya cerrado', () => {
    const file = tempFile()
    const writer = open(file)
    insertSample(writer)
    const reader = openIndexReader(file)
    connections.push(reader)
    expect(reader.prepare('SELECT count(*) FROM usage_events').pluck().get()).toBe(2)
    expect(() => reader.exec("INSERT INTO meta VALUES ('a', 'b')")).toThrow(/readonly/)
    writer.close()
    const later = openIndexReader(file)
    connections.push(later)
    expect(later.prepare('SELECT count(*) FROM meta').pluck().get()).toBe(1)
  })
})

describe('usage_events', () => {
  it('deduplica por clave quedándose con el máximo de cada campo', () => {
    const db = open(tempFile())
    insertSample(db)
    expect(db.prepare('SELECT * FROM usage_events ORDER BY dedupe_key').all()).toEqual([
      { dedupe_key: 'k1', input: 12, output: 1, cache_creation: 0, cache_read: 0 },
      { dedupe_key: 'k2', input: 5, output: 2, cache_creation: 0, cache_read: 0 }
    ])
  })
})

describe('clearIndex', () => {
  it('deja todas las tablas vacías sin cambiar el esquema', () => {
    const db = open(tempFile())
    insertSample(db)
    clearIndex(db)
    for (const table of ['meta', 'files', 'sessions', 'session_usage', 'session_lines'])
      expect(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })
})
