import type Database from 'better-sqlite3'
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../src/main/services/app-store'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { ProjectError, createProjectsService } from '../../src/main/services/projects'

const FIXTURES = join(__dirname, '../fixtures/claude')
const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
const dirs: string[] = []
const connections: Database.Database[] = []

afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Ctx {
  root: string
  claudeDir: string
  service: ReturnType<typeof createProjectsService>
  store: ReturnType<typeof createAppStore>
  folder: (name: string) => string
  tick: () => void
}

/** Carpeta temporal con proyectos de prueba, una copia de los fixtures y su índice. */
async function setup(withIndex = true, home?: string): Promise<Ctx> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-projects-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  let reader: Database.Database | null = null
  if (withIndex) {
    const opened = openIndex(join(root, 'bitacora.db'), quiet)
    if (!opened.ok) throw new Error(opened.error)
    connections.push(opened.db)
    await runPass(opened.db, claudeDir, quiet)
    reader = opened.db
  }
  const store = createAppStore(join(root, 'state.json'), quiet)
  let clock = Date.parse('2026-10-14T10:00:00.000Z')
  const service = createProjectsService({
    store,
    reader,
    claudeDir: () => claudeDir,
    ...(home !== undefined ? { home: () => join(root, home) } : {}),
    now: () => new Date(clock)
  })
  const folder = (name: string): string => {
    const path = join(root, 'work', name)
    mkdirSync(path, { recursive: true })
    return path
  }
  return { root, claudeDir, service, store, folder, tick: () => (clock += 60_000) }
}

async function rejection(promise: Promise<unknown>): Promise<ProjectError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ProjectError)
  return error as ProjectError
}

describe('ProjectsService', () => {
  it('importar: ruta normalizada, nombre de la carpeta, activo', async () => {
    const { service, store, folder } = await setup()
    const path = folder('Nube')
    const view = await service.import(`${path.replace(/\\/g, '/')}/`)
    expect(view).toMatchObject({ path, name: 'Nube', sessionCount: 0, missing: false })
    expect(store.get().activeProjectId).toBe(view.id)
    expect(service.active()).toBe(view.id)
    expect(store.get().projects).toHaveLength(1)
  })

  it('una carpeta ya importada se activa sin duplicar, aunque cambien las mayúsculas', async () => {
    const { service, store, folder, tick } = await setup()
    const a = await service.import(folder('Uno'))
    tick()
    await service.import(folder('Dos'))
    tick()
    const again = await service.import(process.platform === 'win32' ? a.path.toUpperCase() : a.path)
    expect(again.id).toBe(a.id)
    expect(store.get().projects).toHaveLength(2)
    expect(store.get().activeProjectId).toBe(a.id)
    expect((await service.list()).map((p) => p.name)).toEqual(['Uno', 'Dos'])
  })

  it('rechaza carpetas inexistentes, archivos y la carpeta de Claude Code', async () => {
    const { service, claudeDir, root, store } = await setup()
    expect((await rejection(service.import(join(root, 'no-existe')))).message).toBe(
      'La carpeta no existe.'
    )
    expect((await rejection(service.import(join(root, 'state.json')))).code).toBe('INVALID_CWD')
    for (const path of [claudeDir, join(claudeDir, 'projects', 'Z--demo')]) {
      const error = await rejection(service.import(path))
      expect(error).toMatchObject({
        code: 'INVALID_CWD',
        message: 'No se puede importar la carpeta de Claude Code.'
      })
    }
    expect(store.get().projects).toEqual([])
  })

  it('importMany añade varias, ignora las no válidas y activa la primera', async () => {
    const { service, store, folder, root } = await setup()
    const views = await service.importMany([folder('A'), join(root, 'nada'), folder('B')])
    expect(views.map((v) => v.name)).toEqual(['A', 'B'])
    expect(store.get().activeProjectId).toBe(views[0]?.id)
    await expect(service.importMany([join(root, 'nada')])).rejects.toBeInstanceOf(ProjectError)
  })

  it('quitar el activo pasa al más reciente; quitar el último deja ninguno', async () => {
    const { service, store, folder, tick } = await setup()
    const a = await service.import(folder('A'))
    tick()
    const b = await service.import(folder('B'))
    tick()
    const c = await service.import(folder('C'))
    tick()
    service.select(a.id)
    tick()
    const before = statSync(folder('A')).mtimeMs
    service.remove(a.id)
    expect(store.get().activeProjectId).toBe(c.id)
    service.remove(b.id)
    expect(store.get().activeProjectId).toBe(c.id)
    service.remove(c.id)
    expect(store.get()).toMatchObject({ projects: [], activeProjectId: null })
    expect(statSync(folder('A')).mtimeMs).toBe(before)
    expect(() => service.remove(a.id)).toThrow(ProjectError)
  })

  it('select actualiza activeProjectId y lastOpenedAt', async () => {
    const { service, store, folder, tick } = await setup()
    const a = await service.import(folder('A'))
    tick()
    await service.import(folder('B'))
    tick()
    service.select(a.id)
    expect(store.get().activeProjectId).toBe(a.id)
    expect(store.get().projects.find((p) => p.id === a.id)?.lastOpenedAt).toBe(
      '2026-10-14T10:02:00.000Z'
    )
    expect((await service.list())[0]?.id).toBe(a.id)
    expect(() => service.select('00000000-0000-4000-8000-000000000000')).toThrow(ProjectError)
  })

  it('carpeta borrada después: missing y sus sesiones siguen', async () => {
    const { service, folder } = await setup()
    const path = folder('Borrada')
    const view = await service.import(path)
    rmSync(path, { recursive: true })
    expect((await service.list())[0]).toMatchObject({ id: view.id, missing: true })
  })

  it('sesiones y recuentos de un proyecto por su primer cwd', async () => {
    const { service, store } = await setup()
    // Las sesiones de los fixtures son de `Z:\web\Nube`, que puede no existir en este equipo:
    // el proyecto se crea a mano en state.json.
    const id = '11111111-1111-4111-8111-111111111111'
    store.set({
      projects: [
        {
          id,
          path: 'Z:\\web\\Nube',
          name: 'Nube',
          addedAt: '2026-10-14T00:00:00.000Z',
          lastOpenedAt: '2026-10-14T00:00:00.000Z'
        }
      ],
      activeProjectId: id
    })
    const sessions = service.sessions(id)
    expect(sessions).toHaveLength(3)
    expect((await service.list())[0]).toMatchObject({
      sessionCount: 3,
      lastActivityAt: sessions[0]?.updatedAt
    })
    const detail = service.session(sessions[0]?.sessionId ?? '')
    expect(detail?.sessionId).toBe(sessions[0]?.sessionId)
    expect(service.sessions('22222222-2222-4222-8222-222222222222')).toEqual([])
    expect(service.discover().map((d) => d.path)).not.toContain('Z:\\web\\Nube')
    expect(service.discover()).toHaveLength(2)
  })

  it('sin índice: los proyectos funcionan y las listas salen vacías', async () => {
    const { service, folder } = await setup(false)
    const view = await service.import(folder('A'))
    expect(view.sessionCount).toBe(0)
    expect(service.sessions(view.id)).toEqual([])
    expect(service.discover()).toEqual([])
    expect(service.session('x')).toBeNull()
  })

  it('un state.json con un activo que ya no existe → active() null', async () => {
    const { service, store } = await setup()
    store.set({ activeProjectId: '33333333-3333-4333-8333-333333333333' })
    expect(service.active()).toBeNull()
  })

  describe('Mi PC y aspecto', () => {
    it('crea Mi PC una sola vez, con su icono, y no se puede quitar', async () => {
      const { root, store, claudeDir } = await setup(false, 'casa')
      const [computer] = store.get().projects
      expect(computer).toMatchObject({ kind: 'computer', name: 'Mi PC', icon: 'monitor' })
      // Otra instancia del servicio sobre el mismo state.json no lo duplica.
      const again = createProjectsService({
        store,
        reader: null,
        claudeDir: () => claudeDir,
        home: () => join(root, 'casa')
      })
      expect(store.get().projects).toHaveLength(1)
      const error = await rejection(Promise.resolve().then(() => again.remove(computer!.id)))
      expect(error.code).toBe('PROTECTED')
      expect(store.get().projects).toHaveLength(1)
    })

    it('convierte en Mi PC la carpeta personal ya importada', async () => {
      const { store, claudeDir, folder } = await setup(false)
      const home = folder('yo')
      const plain = createProjectsService({ store, reader: null, claudeDir: () => claudeDir })
      const imported = await plain.import(home)
      createProjectsService({ store, reader: null, claudeDir: () => claudeDir, home: () => home })
      expect(store.get().projects).toEqual([
        expect.objectContaining({ id: imported.id, kind: 'computer', name: 'Mi PC' })
      ])
    })

    it('personalizar: nombre, icono y color; null vuelve a lo de antes', async () => {
      const { service, folder } = await setup(false)
      const project = await service.import(folder('Tienda'))
      const custom = await service.customize({
        id: project.id,
        name: '  Mi tienda ',
        icon: 'cart',
        color: 'green'
      })
      expect(custom).toMatchObject({ name: 'Mi tienda', icon: 'cart', color: 'green' })
      const reset = await service.customize({ id: project.id, name: null, icon: null, color: null })
      expect(reset.name).toBe('Tienda')
      expect(reset.icon).toBeUndefined()
      expect(reset.color).toBeUndefined()
      // Lo que no se pasa no cambia.
      await service.customize({ id: project.id, color: 'blue' })
      expect((await service.list())[0]).toMatchObject({ name: 'Tienda', color: 'blue' })
    })
  })
})
