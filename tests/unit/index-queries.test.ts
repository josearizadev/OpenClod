import type Database from 'better-sqlite3'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TokenUsage } from '../../src/shared/sessions'
import {
  discover,
  getSession,
  indexStatus,
  listSessions,
  projectStats
} from '../../src/main/services/index-queries'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { pathKey } from '../../src/main/services/paths'

const FIXTURES = join(__dirname, '../fixtures/claude')
const ORIGIN = 'a55accdd-171f-4711-936e-b51294a4b423'
const CONTINUATION = '9c81d504-7ee7-4a60-a274-500078e29ce3'
const NUBE_RECENT = '07319c10-f4d8-43f5-b876-ec4c89ae65d4'
const WITH_SUBAGENTS = '0e56deca-67ad-4d7c-bc94-a61cc14540cd'
const NUBE = pathKey('Z:\\web\\Nube')
const DEMO = pathKey('Z:\\demo')
const PROGRAMAS = pathKey('C:\\Programas')

const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
const dirs: string[] = []
const connections: Database.Database[] = []

afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Copia de los fixtures (más lo que añada `prepare`) indexada con `runPass`. */
async function indexed(prepare?: (claudeDir: string) => void): Promise<Database.Database> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-queries-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  prepare?.(claudeDir)
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  await runPass(opened.db, claudeDir, quiet)
  return opened.db
}

function ownUsage(db: Database.Database, id: string): TokenUsage {
  return db
    .prepare(
      `SELECT own_input input, own_output output, own_cache_creation cacheCreation,
         own_cache_read cacheRead FROM sessions WHERE session_id = ?`
    )
    .get(id) as TokenUsage
}

const sum = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheCreation: a.cacheCreation + b.cacheCreation,
  cacheRead: a.cacheRead + b.cacheRead
})

/** Escribe una sesión de una línea en `projects/<folder>`. */
function writeSession(
  claudeDir: string,
  folder: string,
  id: string,
  lines: Record<string, unknown>[]
): void {
  const dir = join(claudeDir, 'projects', folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(''))
}

function userPrompt(cwd: string, text: string, timestamp: string): Record<string, unknown> {
  return {
    type: 'user',
    uuid: `u-${timestamp}`,
    timestamp,
    cwd,
    message: { role: 'user', content: text }
  }
}

describe('listSessions', () => {
  it('una entrada por conversación, de la más reciente a la más antigua', async () => {
    const db = await indexed()
    const items = listSessions(db, NUBE)
    expect(items.map((i) => i.sessionId)).toEqual([NUBE_RECENT, WITH_SUBAGENTS, CONTINUATION])

    const chain = items[2]
    const origin = db
      .prepare('SELECT started_at, title FROM sessions WHERE session_id = ?')
      .get(ORIGIN) as { started_at: string }
    const last = db
      .prepare('SELECT title, updated_at, git_branch FROM sessions WHERE session_id = ?')
      .get(CONTINUATION) as { title: string; updated_at: string; git_branch: string }
    expect(chain).toEqual({
      sessionId: CONTINUATION,
      conversationId: ORIGIN,
      title: last.title,
      startedAt: origin.started_at,
      updatedAt: last.updated_at,
      gitBranch: last.git_branch,
      usage: sum(ownUsage(db, ORIGIN), ownUsage(db, CONTINUATION)),
      chainLength: 2,
      lastWriteAt: expect.any(Number)
    })
    // `lastWriteAt` = mtime más reciente de los archivos de la sesión.
    const mtime = db
      .prepare('SELECT max(mtime_ms) m FROM files WHERE session_id = ?')
      .get(CONTINUATION) as { m: number }
    expect(chain?.lastWriteAt).toBe(Math.round(mtime.m))
    expect(getSession(db, CONTINUATION)?.lastWriteAt).toBe(Math.round(mtime.m))
    // Una sesión suelta: su uso propio es todo su uso.
    expect(items[0]?.chainLength).toBe(1)
    expect(items[0]?.usage).toEqual(ownUsage(db, NUBE_RECENT))
  })

  it('oculta las sesiones sin prompts y las cuenta en el estado', async () => {
    const db = await indexed((dir) =>
      writeSession(dir, 'Z--demo', '00000000-0000-4000-8000-0000000000aa', [
        {
          type: 'user',
          uuid: 'u-cmd',
          timestamp: '2026-10-05T10:00:00.000Z',
          cwd: 'Z:\\demo',
          message: {
            role: 'user',
            content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>'
          }
        }
      ])
    )
    expect(listSessions(db, DEMO).map((i) => i.sessionId)).toEqual([
      '00000000-0000-4000-8000-000000000001'
    ])
    expect(indexStatus(db, { path: 'x', running: false }).hiddenSessions).toBe(1)
    expect(projectStats(db, [DEMO]).get(DEMO)?.sessionCount).toBe(1)
  })

  it('una sesión que empieza con un comando y tiene respuesta sí se lista, con el comando de título', async () => {
    const id = '00000000-0000-4000-8000-0000000000cc'
    const db = await indexed((dir) =>
      writeSession(dir, 'Z--demo', id, [
        {
          type: 'user',
          uuid: 'u-cmd',
          timestamp: '2026-10-06T10:00:00.000Z',
          cwd: 'Z:\\demo',
          message: {
            role: 'user',
            content:
              '<command-message>siguiente</command-message>\n<command-name>/siguiente</command-name>\n<command-args>Termina la fase 2.</command-args>'
          }
        },
        {
          type: 'assistant',
          uuid: 'a-1',
          timestamp: '2026-10-06T10:00:05.000Z',
          cwd: 'Z:\\demo',
          requestId: 'req-cc',
          message: {
            id: 'msg-cc',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [{ type: 'text', text: 'Hecho.' }],
            usage: { input_tokens: 1, output_tokens: 2 }
          }
        }
      ])
    )
    expect(listSessions(db, DEMO)[0]).toMatchObject({
      sessionId: id,
      title: '/siguiente Termina la fase 2.'
    })
    expect(getSession(db, id)?.titleSource).toBe('command')
    expect(indexStatus(db, { path: 'x', running: false }).hiddenSessions).toBe(0)
  })

  it('enlace roto: si falta la continuación, se lista la anterior', async () => {
    const db = await indexed((dir) => {
      rmSync(join(dir, 'projects', 'Z--web-Nube', `${CONTINUATION}.jsonl`))
      rmSync(join(dir, 'projects', 'Z--web-Nube', CONTINUATION), { recursive: true })
    })
    const items = listSessions(db, NUBE)
    expect(items.map((i) => i.sessionId)).toEqual([NUBE_RECENT, WITH_SUBAGENTS, ORIGIN])
    expect(items[2]?.chainLength).toBe(1)
  })

  it('proyecto sin sesiones o clave desconocida → lista vacía', async () => {
    const db = await indexed()
    expect(listSessions(db, pathKey('Z:\\otro'))).toEqual([])
  })
})

describe('getSession', () => {
  it('ficha con la cadena en orden y el uso de la conversación', async () => {
    const db = await indexed()
    const detail = getSession(db, CONTINUATION)
    expect(detail).toMatchObject({
      sessionId: CONTINUATION,
      chain: [ORIGIN, CONTINUATION],
      chainLength: 2,
      continuedFrom: ORIGIN,
      ownUsage: ownUsage(db, CONTINUATION),
      usage: sum(ownUsage(db, ORIGIN), ownUsage(db, CONTINUATION)),
      cwd: process.platform === 'win32' ? 'Z:\\web\\Nube' : 'Z:\\web\\Nube'
    })
    expect(detail?.models.length).toBeGreaterThan(0)
    expect(listSessions(db, NUBE).find((i) => i.sessionId === CONTINUATION)?.usage).toEqual(
      detail?.usage
    )

    const subagents = getSession(db, WITH_SUBAGENTS)
    expect(subagents).toMatchObject({ chain: [WITH_SUBAGENTS], subagentCount: 2 })
    expect(subagents?.continuedFrom).toBeUndefined()
  })

  it('sesión que no está → null', async () => {
    const db = await indexed()
    expect(getSession(db, 'no-existe')).toBeNull()
  })
})

describe('projectStats y discover', () => {
  it('recuentos y última actividad por proyecto', async () => {
    const db = await indexed()
    const stats = projectStats(db, [NUBE, PROGRAMAS, pathKey('Z:\\otro')])
    expect(stats.get(NUBE)).toEqual({
      sessionCount: 3,
      lastActivityAt: listSessions(db, NUBE)[0]?.updatedAt
    })
    expect(stats.get(PROGRAMAS)?.sessionCount).toBe(1)
    expect(stats.has(pathKey('Z:\\otro'))).toBe(false)
    expect(projectStats(db, []).size).toBe(0)
  })

  it.runIf(process.platform === 'win32')(
    'agrupa por el primer cwd sin distinguir mayúsculas y excluye los importados',
    async () => {
      const db = await indexed((dir) => {
        // Otra carpeta codificada, misma ruta con otras mayúsculas y separadores; más reciente.
        writeSession(dir, 'z--WEB-nube', '00000000-0000-4000-8000-0000000000bb', [
          userPrompt('z:/WEB/nube/', 'Hola', '2026-10-15T08:00:00.000Z'),
          userPrompt('z:/WEB/nube/src', 'Sigue', '2026-10-15T08:01:00.000Z')
        ])
      })
      expect(discover(db, [])).toEqual([
        { path: 'Z:\\WEB\\nube', sessionCount: 4, lastActivityAt: '2026-10-15T08:01:00.000Z' },
        { path: 'Z:\\demo', sessionCount: 1, lastActivityAt: '2026-10-01T10:00:09.000Z' },
        { path: 'C:\\Programas', sessionCount: 1, lastActivityAt: '2026-09-30T13:47:38.965Z' }
      ])
      expect(listSessions(db, NUBE)).toHaveLength(4)
      expect(discover(db, [NUBE, PROGRAMAS]).map((d) => d.path)).toEqual(['Z:\\demo'])
    }
  )
})

describe('indexStatus', () => {
  it('recuentos, esquema y última pasada', async () => {
    const db = await indexed()
    expect(indexStatus(db, { path: 'C:\\x\\bitacora.db', running: true })).toMatchObject({
      path: 'C:\\x\\bitacora.db',
      ok: true,
      schemaVersion: 3,
      search: { messages: expect.any(Number) },
      files: 12,
      sessions: 6,
      usageEvents: 246,
      // Línea GLOBAL de recuento-tokens.py.
      usage: { input: 502, output: 329810, cacheCreation: 859933, cacheRead: 47904907 },
      hiddenSessions: 0,
      running: true,
      lastPass: { filesRead: 12, changedSessions: 6, removedSessions: 0 }
    })
  })

  it('sin pasadas: sin lastPass', () => {
    const root = mkdtempSync(join(tmpdir(), 'bitacora-queries-'))
    dirs.push(root)
    const opened = openIndex(join(root, 'bitacora.db'), quiet)
    if (!opened.ok) throw new Error(opened.error)
    connections.push(opened.db)
    const status = indexStatus(opened.db, { path: 'x', running: false })
    expect(status).toMatchObject({ sessions: 0, files: 0, usageEvents: 0 })
    expect(status.lastPass).toBeUndefined()
  })
})
