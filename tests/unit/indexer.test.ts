import type Database from 'better-sqlite3'
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { TokenUsage } from '../../src/shared/sessions'
import { listProjects } from '../../src/main/services/claude-paths'
import { clearIndex, openIndex } from '../../src/main/services/index-schema'
import { searchTextOf } from '../../src/main/services/search-text'
import { runPass, type PassResult } from '../../src/main/services/indexer'
import { loadSession } from '../../src/main/services/session-loader'

const FIXTURES = join(__dirname, '../fixtures/claude')
const DEMO = '00000000-0000-4000-8000-000000000001'
const ORIGIN = 'a55accdd-171f-4711-936e-b51294a4b423'
const CONTINUATION = '9c81d504-7ee7-4a60-a274-500078e29ce3'
const WITH_SUBAGENTS = '0e56deca-67ad-4d7c-bc94-a61cc14540cd'

/** Línea GLOBAL de `scripts/recuento-tokens.py` sobre los fixtures. */
const GLOBAL: TokenUsage = {
  input: 502,
  output: 329810,
  cacheCreation: 859933,
  cacheRead: 47904907
}

const dirs: string[] = []
const connections: Database.Database[] = []

afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type MockLog = Record<'info' | 'warn' | 'error', Mock<(scope: string, message: unknown) => void>>

function silentLog(): MockLog {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/** Copia de los fixtures en una carpeta temporal + índice nuevo. */
function setup(): { claudeDir: string; db: Database.Database } {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-indexer-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  const opened = openIndex(join(root, 'bitacora.db'), silentLog())
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  return { claudeDir, db: opened.db }
}

function pass(db: Database.Database, claudeDir: string): Promise<PassResult> {
  return runPass(db, claudeDir, silentLog())
}

function globalUsage(db: Database.Database): TokenUsage & { events: number } {
  return db
    .prepare(
      `SELECT count(*) events, coalesce(sum(input), 0) input, coalesce(sum(output), 0) output,
         coalesce(sum(cache_creation), 0) cacheCreation, coalesce(sum(cache_read), 0) cacheRead
       FROM usage_events`
    )
    .get() as TokenUsage & { events: number }
}

interface Row {
  session_id: string
  input: number
  output: number
  cache_creation: number
  cache_read: number
  own_input: number
  own_output: number
  own_cache_creation: number
  own_cache_read: number
  conversation_id: string
  continued_from: string | null
  inherited_until_line: number | null
  subagent_count: number
  prompt_count: number
  project_key: string | null
}

function session(db: Database.Database, id: string): Row | undefined {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(id) as Row | undefined
}

const usageOf = (r: Row): TokenUsage => ({
  input: r.input,
  output: r.output,
  cacheCreation: r.cache_creation,
  cacheRead: r.cache_read
})
const ownOf = (r: Row): TokenUsage => ({
  input: r.own_input,
  output: r.own_output,
  cacheCreation: r.own_cache_creation,
  cacheRead: r.own_cache_read
})

/** El uso de cada sesión del índice es el de la carga completa. */
async function expectMatchesLoader(db: Database.Database, claudeDir: string): Promise<void> {
  const listing = await listProjects(claudeDir)
  if (!listing.ok) throw new Error(listing.reason)
  const refs = listing.projects.flatMap((p) => p.sessions)
  expect(db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(refs.length)
  for (const ref of refs) {
    const loaded = await loadSession(ref)
    const row = session(db, ref.sessionId)
    expect(row, ref.sessionId).toBeDefined()
    expect(usageOf(row as Row), ref.sessionId).toEqual(loaded.summary.usage)
    expect((row as Row).subagent_count).toBe(loaded.summary.subagents.length)
  }
}

function mainFile(claudeDir: string, folder: string, id: string): string {
  return join(claudeDir, 'projects', folder, `${id}.jsonl`)
}

function assistantLine(id: string, usage: TokenUsage): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${id}`,
    sessionId: 'prueba',
    timestamp: '2026-10-02T10:00:00.000Z',
    cwd: 'Z:/demo',
    requestId: `req-${id}`,
    message: {
      id: `msg-${id}`,
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'Más' }],
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_creation_input_tokens: usage.cacheCreation,
        cache_read_input_tokens: usage.cacheRead
      }
    }
  })
}

function mtimes(dir: string): Record<string, number> {
  const out: Record<string, number> = {}
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[path] = statSync(path).mtimeMs
    }
  }
  walk(dir)
  return out
}

describe('runPass', () => {
  it('primera pasada: sesiones, enlaces y uso global igual a recuento-tokens.py', async () => {
    const { claudeDir, db } = setup()
    const result = await pass(db, claudeDir)

    expect(result).toMatchObject({ filesRead: 12, changedSessions: 6, removedSessions: 0 })
    expect(result.error).toBeUndefined()
    expect(globalUsage(db)).toEqual({ ...GLOBAL, events: 246 })
    await expectMatchesLoader(db, claudeDir)

    const origin = session(db, ORIGIN) as Row
    const continuation = session(db, CONTINUATION) as Row
    expect(continuation.conversation_id).toBe(ORIGIN)
    expect(continuation.continued_from).toBe(ORIGIN)
    expect(continuation.inherited_until_line).toBeGreaterThan(0)
    expect(ownOf(continuation)).toEqual({
      input: 6,
      output: 2298,
      cacheCreation: 26861,
      cacheRead: 286861
    })
    expect(origin.conversation_id).toBe(ORIGIN)
    expect(ownOf(origin)).toEqual(usageOf(origin))
    expect(session(db, DEMO)?.project_key).toBe(
      process.platform === 'win32' ? 'z:\\demo' : 'Z:/demo'
    )

    const meta = db.prepare("SELECT value FROM meta WHERE key = 'last_pass'").pluck().get()
    expect(JSON.parse(meta as string)).toMatchObject({ filesRead: 12, changedSessions: 6 })
  })

  it('segunda pasada sin cambios no lee nada', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const result = await pass(db, claudeDir)
    expect(result).toMatchObject({ filesRead: 0, changedSessions: 0, removedSessions: 0 })
    expect(globalUsage(db)).toEqual({ ...GLOBAL, events: 246 })
  })

  it('líneas nuevas: solo se lee ese archivo, también una línea final incompleta', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    // El fixture de demo acaba en una línea a medias; este termina en salto de línea.
    const file = mainFile(claudeDir, 'Z--web-Nube', '07319c10-f4d8-43f5-b876-ec4c89ae65d4')
    const extra = { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 }
    const line = assistantLine('nuevo', extra)

    appendFileSync(file, line.slice(0, 40))
    const partial = await pass(db, claudeDir)
    expect(partial).toMatchObject({ filesRead: 1, changedSessions: 1 })
    expect(globalUsage(db)).toEqual({ ...GLOBAL, events: 246 })

    appendFileSync(file, `${line.slice(40)}\n`)
    const complete = await pass(db, claudeDir)
    expect(complete).toMatchObject({ filesRead: 1, changedSessions: 1 })
    expect(globalUsage(db)).toEqual({
      input: GLOBAL.input + 1,
      output: GLOBAL.output + 2,
      cacheCreation: GLOBAL.cacheCreation + 3,
      cacheRead: GLOBAL.cacheRead + 4,
      events: 247
    })
    await expectMatchesLoader(db, claudeDir)
  })

  it('un archivo que encoge se relee entero', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const file = mainFile(claudeDir, 'C--Programas', '3f010094-259d-4b05-80f2-637772220194')
    const lines = readFileSync(file, 'utf8').split('\n')
    writeFileSync(file, `${lines.slice(0, 100).join('\n')}\n`)

    const result = await pass(db, claudeDir)
    expect(result).toMatchObject({ filesRead: 1, changedSessions: 1 })
    await expectMatchesLoader(db, claudeDir)
  })

  it('borrar la sesión de origen: la continuación pasa a tener todo su uso como propio', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    rmSync(mainFile(claudeDir, 'Z--web-Nube', ORIGIN))
    rmSync(join(claudeDir, 'projects', 'Z--web-Nube', ORIGIN), { recursive: true })

    const result = await pass(db, claudeDir)
    expect(result).toMatchObject({ filesRead: 0, removedSessions: 1 })
    expect(session(db, ORIGIN)).toBeUndefined()
    expect(db.prepare('SELECT count(*) FROM files WHERE session_id = ?').pluck().get(ORIGIN)).toBe(
      0
    )
    expect(
      db.prepare('SELECT count(*) FROM session_lines WHERE session_id = ?').pluck().get(ORIGIN)
    ).toBe(0)

    const continuation = session(db, CONTINUATION) as Row
    expect(continuation.conversation_id).toBe(CONTINUATION)
    expect(continuation.continued_from).toBeNull()
    expect(continuation.inherited_until_line).toBeNull()
    expect(ownOf(continuation)).toEqual(usageOf(continuation))
    await expectMatchesLoader(db, claudeDir)
  })

  it('borrar la continuación: el enlace queda roto y el origen no cambia', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const before = session(db, ORIGIN) as Row
    rmSync(mainFile(claudeDir, 'Z--web-Nube', CONTINUATION))
    rmSync(join(claudeDir, 'projects', 'Z--web-Nube', CONTINUATION), { recursive: true })

    await pass(db, claudeDir)
    expect(session(db, CONTINUATION)).toBeUndefined()
    expect(session(db, ORIGIN)).toEqual(before)
  })

  it('borrar un subagente recalcula su sesión', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const subDir = join(claudeDir, 'projects', 'Z--web-Nube', WITH_SUBAGENTS, 'subagents')
    rmSync(join(subDir, 'agent-a87cb1297b966067e.jsonl'))

    const result = await pass(db, claudeDir)
    expect(result).toMatchObject({ filesRead: 0, changedSessions: 1, removedSessions: 0 })
    expect(session(db, WITH_SUBAGENTS)?.subagent_count).toBe(1)
    await expectMatchesLoader(db, claudeDir)
  })

  it('otra carpeta de Claude Code vacía el índice', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const other = join(dirs[0] as string, 'otra')
    mkdirSync(join(other, 'projects'), { recursive: true })
    cpSync(join(claudeDir, 'projects', 'Z--demo'), join(other, 'projects', 'Z--demo'), {
      recursive: true
    })

    const result = await pass(db, other)
    expect(result).toMatchObject({ filesRead: 1, changedSessions: 1 })
    expect(db.prepare('SELECT session_id FROM sessions').pluck().all()).toEqual([DEMO])
    expect(db.prepare("SELECT value FROM meta WHERE key = 'claude_dir'").pluck().get()).toBe(other)
  })

  it('otra versión del parser vacía el índice y relee todo', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'parser_version'").run()

    const result = await pass(db, claudeDir)
    expect(result).toMatchObject({ filesRead: 12, changedSessions: 6 })
    expect(globalUsage(db)).toEqual({ ...GLOBAL, events: 246 })
  })

  it('carpeta inexistente: índice vacío y motivo', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    rmSync(join(claudeDir, 'projects'), { recursive: true })

    const result = await pass(db, claudeDir)
    expect(result.removedSessions).toBe(6)
    expect(result.error).toMatch(/^No existe la carpeta/)
    expect(db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(0)
    expect(globalUsage(db).events).toBe(0)
  })

  it('no modifica nada en la carpeta de Claude Code', async () => {
    const { claudeDir, db } = setup()
    const before = mtimes(claudeDir)
    const fixtures = mtimes(FIXTURES)
    await pass(db, claudeDir)
    await pass(db, claudeDir)
    expect(mtimes(claudeDir)).toEqual(before)
    expect(mtimes(FIXTURES)).toEqual(fixtures)
  })
})

describe('texto para la búsqueda', () => {
  /** Lo guardado coincide con `searchTextOf` sobre una lectura completa de cada sesión. */
  async function expectTextsMatchLoader(db: Database.Database, claudeDir: string): Promise<void> {
    const listed = await listProjects(claudeDir)
    if (!listed.ok) throw new Error(listed.reason)
    for (const project of listed.projects) {
      for (const ref of project.sessions) {
        const expected = (await loadSession(ref)).items
          .map(searchTextOf)
          .filter((t) => t !== null)
          .map((t) => [t.uuid, t.role, t.line, t.text])
        const stored = db
          .prepare(
            'SELECT uuid, role, line, text FROM message_text WHERE session_id = ? ORDER BY id'
          )
          .raw()
          .all(ref.sessionId)
        expect(stored).toEqual(expected)
      }
    }
  }

  it('pasada completa e incremental guardan el texto sin duplicar', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const count = (): number =>
      db.prepare<[], number>('SELECT count(*) FROM message_text').pluck().get() ?? 0
    expect(count()).toBeGreaterThan(50)
    await expectTextsMatchLoader(db, claudeDir)

    const file = mainFile(claudeDir, 'Z--web-Nube', '07319c10-f4d8-43f5-b876-ec4c89ae65d4')
    appendFileSync(
      file,
      `${JSON.stringify({ type: 'user', uuid: 'u-nuevo', timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'Una búsqueda nueva' } })}\n`
    )
    await pass(db, claudeDir)
    await expectTextsMatchLoader(db, claudeDir)
    expect(
      db
        .prepare("SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'busqueda'")
        .pluck()
        .get()
    ).toBeGreaterThan(0)

    // Encoger relee entero: se borra lo de antes.
    const big = mainFile(claudeDir, 'C--Programas', '3f010094-259d-4b05-80f2-637772220194')
    const lines = readFileSync(big, 'utf8').split('\n')
    writeFileSync(big, `${lines.slice(0, 100).join('\n')}\n`)
    await pass(db, claudeDir)
    await expectTextsMatchLoader(db, claudeDir)
  })

  it('quitar la sesión y clearIndex borran el texto', async () => {
    const { claudeDir, db } = setup()
    await pass(db, claudeDir)
    const id = '3f010094-259d-4b05-80f2-637772220194'
    rmSync(mainFile(claudeDir, 'C--Programas', id))
    await pass(db, claudeDir)
    expect(
      db.prepare('SELECT count(*) FROM message_text WHERE session_id = ?').pluck().get(id)
    ).toBe(0)
    clearIndex(db)
    expect(db.prepare('SELECT count(*) FROM message_text').pluck().get()).toBe(0)
    expect(db.prepare('SELECT count(*) FROM messages_fts_docsize').pluck().get()).toBe(0)
  })

  it('progreso solo con más de 20 sesiones sucias', async () => {
    const { claudeDir, db } = setup()
    const progress = vi.fn()
    await runPass(db, claudeDir, silentLog(), progress)
    // Los fixtures tienen pocas sesiones: no se informa.
    expect(progress).not.toHaveBeenCalled()

    const folder = join(claudeDir, 'projects', 'Z--demo')
    const source = readFileSync(join(folder, '00000000-0000-4000-8000-000000000001.jsonl'), 'utf8')
    for (let i = 10; i < 45; i++) {
      writeFileSync(join(folder, `00000000-0000-4000-8000-0000000000${i}.jsonl`), source)
    }
    await runPass(db, claudeDir, silentLog(), progress)
    expect(progress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 35 },
      { done: 10, total: 35 },
      { done: 20, total: 35 },
      { done: 30, total: 35 }
    ])
  })
})
