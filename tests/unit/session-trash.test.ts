import type Database from 'better-sqlite3'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { trashSessions, type TrashDeps } from '../../src/main/services/session-trash'

const FIXTURES = join(__dirname, '../fixtures/claude')
const ORIGIN = 'a55accdd-171f-4711-936e-b51294a4b423'
const CONTINUATION = '9c81d504-7ee7-4a60-a274-500078e29ce3'
const NUBE_RECENT = '07319c10-f4d8-43f5-b876-ec4c89ae65d4'

const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
const dirs: string[] = []
const connections: Database.Database[] = []

afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup(): Promise<{
  claudeDir: string
  nube: string
  db: Database.Database
  trashed: string[]
  deps: TrashDeps
}> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-trash-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  await runPass(opened.db, claudeDir, quiet)
  const trashed: string[] = []
  const deps: TrashDeps = {
    reader: opened.db,
    projectsDir: join(claudeDir, 'projects'),
    chatState: () => null,
    closeChat: () => Promise.resolve(),
    trash: (path) => {
      trashed.push(path)
      rmSync(path, { recursive: true, force: true })
      return Promise.resolve()
    }
  }
  return {
    claudeDir,
    nube: join(claudeDir, 'projects', 'Z--web-Nube'),
    db: opened.db,
    trashed,
    deps
  }
}

describe('eliminar conversaciones a la papelera', () => {
  it('mueve la cadena entera: cada .jsonl y su carpeta, nada más', async () => {
    const { nube, trashed, deps, claudeDir, db } = await setup()
    const result = await trashSessions([CONTINUATION], deps)
    expect(result).toEqual({ trashed: [CONTINUATION], skipped: [], conversations: [ORIGIN] })
    expect([...trashed].sort()).toEqual(
      [
        join(nube, `${ORIGIN}.jsonl`),
        join(nube, ORIGIN),
        join(nube, `${CONTINUATION}.jsonl`),
        join(nube, CONTINUATION)
      ].sort()
    )
    // El resto del proyecto (otras sesiones, memoria) sigue en su sitio.
    expect(existsSync(join(nube, `${NUBE_RECENT}.jsonl`))).toBe(true)
    expect(existsSync(join(nube, 'memory', 'MEMORY.md'))).toBe(true)
    // La pasada siguiente las quita del índice.
    await runPass(db, claudeDir, quiet)
    const left = db
      .prepare('SELECT count(*) FROM sessions WHERE session_id IN (?, ?)')
      .pluck()
      .get(ORIGIN, CONTINUATION)
    expect(left).toBe(0)
  })

  it('dos entradas de la misma conversación la mueven una vez; un id desconocido se salta', async () => {
    const { trashed, deps } = await setup()
    const result = await trashSessions([ORIGIN, CONTINUATION, 'no-existe'], deps)
    expect(result.trashed).toEqual([ORIGIN, CONTINUATION])
    expect(result.skipped).toEqual([{ sessionId: 'no-existe', reason: 'not-found' }])
    expect(trashed).toHaveLength(4)
  })

  it('no toca una conversación con Claude trabajando y cierra antes el chat en reposo', async () => {
    const { trashed, deps } = await setup()
    const active = await trashSessions([CONTINUATION], {
      ...deps,
      chatState: (id) => (id === ORIGIN ? 'active' : null)
    })
    expect(active.skipped).toEqual([{ sessionId: CONTINUATION, reason: 'active' }])
    expect(trashed).toEqual([])

    const closed: string[] = []
    await trashSessions([NUBE_RECENT], {
      ...deps,
      chatState: (id) => (id === NUBE_RECENT ? 'idle' : null),
      closeChat: (id) => {
        closed.push(id)
        // Se cierra antes de mover nada.
        expect(trashed).toEqual([])
        return Promise.resolve()
      }
    })
    expect(closed).toEqual([NUBE_RECENT])
  })

  it('omite rutas fuera de projects/ o con otro nombre', async () => {
    const { trashed, deps, db } = await setup()
    db.prepare('UPDATE sessions SET file = ? WHERE session_id = ?').run(
      join(tmpdir(), `${NUBE_RECENT}.jsonl`),
      NUBE_RECENT
    )
    const result = await trashSessions([NUBE_RECENT], deps)
    expect(result.skipped).toEqual([{ sessionId: NUBE_RECENT, reason: 'failed' }])
    expect(trashed).toEqual([])
  })

  it('si la papelera falla, lo cuenta como no movida', async () => {
    const { deps } = await setup()
    const result = await trashSessions([NUBE_RECENT], {
      ...deps,
      trash: () => Promise.reject(new Error('sin permiso'))
    })
    expect(result).toEqual({
      trashed: [],
      skipped: [{ sessionId: NUBE_RECENT, reason: 'failed' }],
      conversations: []
    })
  })
})
