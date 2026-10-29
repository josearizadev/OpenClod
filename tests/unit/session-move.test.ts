import type Database from 'better-sqlite3'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { claudeFolderName, moveSessions, type MoveDeps } from '../../src/main/services/session-move'
import { listSessions } from '../../src/main/services/index-queries'
import { pathKey } from '../../src/main/services/paths'

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
  root: string
  claudeDir: string
  projectsDir: string
  nube: string
  db: Database.Database
  deps: MoveDeps
}> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-move-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  await runPass(opened.db, claudeDir, quiet)
  const projectsDir = join(claudeDir, 'projects')
  return {
    root,
    claudeDir,
    projectsDir,
    nube: join(projectsDir, 'Z--web-Nube'),
    db: opened.db,
    deps: {
      reader: opened.db,
      projectsDir,
      chatState: () => null,
      closeChat: () => Promise.resolve()
    }
  }
}

describe('mover conversaciones a otro proyecto', () => {
  it('carpeta de Claude Code para un cwd', () => {
    expect(claudeFolderName('Z:\\web\\bitacora')).toBe('Z--web-bitacora')
    expect(claudeFolderName('/home/ana/mi proyecto.v2')).toBe('-home-ana-mi-proyecto-v2')
    expect(claudeFolderName(`C:\\${'a'.repeat(300)}`)).toBeNull()
  })

  it('mueve la cadena entera con sus carpetas y el índice la lista en el destino', async () => {
    const { projectsDir, nube, deps, db, claudeDir } = await setup()
    const dest = 'Z:\\web\\Destino'
    const result = await moveSessions([CONTINUATION], dest, deps)
    expect(result).toEqual({
      moved: [CONTINUATION],
      skipped: [],
      sessions: expect.arrayContaining([ORIGIN, CONTINUATION]) as unknown as string[]
    })
    const target = join(projectsDir, 'Z--web-Destino')
    for (const name of [`${ORIGIN}.jsonl`, ORIGIN, `${CONTINUATION}.jsonl`, CONTINUATION]) {
      expect(existsSync(join(target, name))).toBe(true)
      expect(existsSync(join(nube, name))).toBe(false)
    }
    expect(existsSync(join(nube, `${NUBE_RECENT}.jsonl`))).toBe(true)

    const moves = Object.fromEntries(result.sessions.map((id) => [id, dest]))
    await runPass(db, claudeDir, quiet, undefined, moves)
    expect(listSessions(db, pathKey(dest)).map((s) => s.sessionId)).toEqual([CONTINUATION])
    const cwd = db
      .prepare('SELECT start_cwd FROM sessions WHERE session_id = ?')
      .pluck()
      .get(ORIGIN)
    expect(cwd).toBe(dest)
    // Una pasada posterior sin cambios mantiene la reasignación.
    await runPass(db, claudeDir, quiet, undefined, moves)
    expect(listSessions(db, pathKey(dest))).toHaveLength(1)
  })

  it('usa la carpeta que ya tienen las sesiones del destino', async () => {
    const { projectsDir, deps, db } = await setup()
    const other = db
      .prepare<[string, string], { start_cwd: string; folder: string }>(
        'SELECT start_cwd, folder FROM sessions WHERE session_id != ? AND folder != ? LIMIT 1'
      )
      .get(ORIGIN, 'Z--web-Nube')
    if (!other) throw new Error('fixture sin otro proyecto')
    await moveSessions([ORIGIN], other.start_cwd, deps)
    expect(existsSync(join(projectsDir, other.folder, `${ORIGIN}.jsonl`))).toBe(true)
  })

  it('no mueve una conversación con un chat trabajando', async () => {
    const { nube, deps } = await setup()
    const result = await moveSessions([ORIGIN], 'Z:\\x', {
      ...deps,
      chatState: (id) => (id === CONTINUATION ? 'active' : null)
    })
    expect(result.skipped).toEqual([{ sessionId: ORIGIN, reason: 'active' }])
    expect(existsSync(join(nube, `${ORIGIN}.jsonl`))).toBe(true)
  })

  it('si ya existe en el destino, no mueve nada', async () => {
    const { projectsDir, nube, deps } = await setup()
    const target = join(projectsDir, 'Z--x')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, `${CONTINUATION}.jsonl`), '')
    const result = await moveSessions([ORIGIN], 'Z:\\x', deps)
    expect(result.skipped).toEqual([{ sessionId: ORIGIN, reason: 'conflict' }])
    expect(existsSync(join(nube, `${ORIGIN}.jsonl`))).toBe(true)
  })

  it('si un movimiento falla, deshace los anteriores', async () => {
    const { nube, deps } = await setup()
    let calls = 0
    const { rename } = await import('node:fs/promises')
    const result = await moveSessions([ORIGIN], 'Z:\\x', {
      ...deps,
      rename: async (from, to) => {
        calls += 1
        if (calls === 2) throw new Error('EBUSY')
        await rename(from, to)
      }
    })
    expect(result.skipped).toEqual([{ sessionId: ORIGIN, reason: 'failed' }])
    for (const name of [`${ORIGIN}.jsonl`, ORIGIN, `${CONTINUATION}.jsonl`, CONTINUATION]) {
      expect(existsSync(join(nube, name))).toBe(true)
    }
  })
})
