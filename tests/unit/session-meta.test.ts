import type Database from 'better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../src/main/services/app-store'
import { clearIndex, openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { createProjectsService } from '../../src/main/services/projects'
import { invokeContract } from '../../src/shared/ipc-contract'

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
  db: Database.Database
  store: ReturnType<typeof createAppStore>
  service: ReturnType<typeof createProjectsService>
  nube: string
}> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-meta-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  await runPass(opened.db, claudeDir, quiet)
  const store = createAppStore(join(root, 'state.json'), quiet)
  const project = {
    id: '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f',
    path: 'Z:\\web\\Nube',
    name: 'Nube',
    addedAt: '2026-10-14T10:00:00.000Z',
    lastOpenedAt: '2026-10-14T10:00:00.000Z'
  }
  store.set({ projects: [project], activeProjectId: project.id })
  const service = createProjectsService({
    store,
    reader: opened.db,
    claudeDir: () => claudeDir,
    now: () => new Date('2026-10-14T12:00:00.000Z')
  })
  return { root, claudeDir, db: opened.db, store, service, nube: project.id }
}

describe('datos propios de las sesiones', () => {
  it('renombrar guarda por conversación y se ve en lista y ficha con `titleSource: app`', async () => {
    const { store, service, nube } = await setup()
    const item = service.update({ sessionId: CONTINUATION, title: '  Mi conversación  ' })
    expect(item).toMatchObject({ sessionId: CONTINUATION, title: 'Mi conversación' })
    // La clave es el `conversationId`: el de la sesión de origen.
    expect(store.get().sessionMeta).toEqual({
      [ORIGIN]: { title: 'Mi conversación', updatedAt: '2026-10-14T12:00:00.000Z' }
    })
    expect(service.sessions(nube).find((s) => s.sessionId === CONTINUATION)?.title).toBe(
      'Mi conversación'
    )
    expect(service.session(CONTINUATION)).toMatchObject({
      title: 'Mi conversación',
      titleSource: 'app'
    })
    // Renombrar desde la sesión de origen toca la misma entrada.
    service.update({ sessionId: ORIGIN, title: 'Otro' })
    expect(Object.keys(store.get().sessionMeta)).toEqual([ORIGIN])
    expect(service.session(CONTINUATION)?.title).toBe('Otro')
  })

  it('título vacío, solo espacios o null vuelve al calculado', async () => {
    const { store, service } = await setup()
    const original = service.session(NUBE_RECENT)
    for (const title of ['', '   ', null]) {
      service.update({ sessionId: NUBE_RECENT, title: 'Provisional' })
      service.update({ sessionId: NUBE_RECENT, title })
      expect(service.session(NUBE_RECENT)).toMatchObject({
        title: original?.title,
        titleSource: original?.titleSource
      })
      expect(store.get().sessionMeta).toEqual({})
    }
  })

  it('favorita y oculta en lista y ficha; la entrada vacía se borra', async () => {
    const { store, service, nube } = await setup()
    expect(service.sessions(nube).every((s) => !s.favorite && !s.hidden)).toBe(true)
    service.update({ sessionId: NUBE_RECENT, favorite: true })
    service.update({ sessionId: CONTINUATION, hidden: true })
    const list = service.sessions(nube)
    expect(list.find((s) => s.sessionId === NUBE_RECENT)).toMatchObject({
      favorite: true,
      hidden: false
    })
    // Las ocultas siguen en `sessions:list`: el renderer decide si las enseña.
    expect(list.find((s) => s.sessionId === CONTINUATION)).toMatchObject({ hidden: true })
    expect(service.session(NUBE_RECENT)).toMatchObject({ favorite: true })

    service.update({ sessionId: NUBE_RECENT, title: 'X' })
    service.update({ sessionId: NUBE_RECENT, favorite: false })
    expect(store.get().sessionMeta[NUBE_RECENT]).toMatchObject({ title: 'X' })
    expect(store.get().sessionMeta[NUBE_RECENT]?.favorite).toBeUndefined()
    service.update({ sessionId: NUBE_RECENT, title: null })
    service.update({ sessionId: CONTINUATION, hidden: false })
    expect(store.get().sessionMeta).toEqual({})
  })

  it('sesión desconocida → null sin tocar `state.json`', async () => {
    const { root, service } = await setup()
    const before = readFileSync(join(root, 'state.json'), 'utf8')
    expect(service.update({ sessionId: 'no-existe', favorite: true })).toBeNull()
    expect(readFileSync(join(root, 'state.json'), 'utf8')).toBe(before)
  })

  it('sobrevive a «Reconstruir índice» y cuenta las huérfanas en Diagnóstico', async () => {
    const { claudeDir, db, store, service } = await setup()
    service.update({ sessionId: NUBE_RECENT, title: 'Guardada', favorite: true })
    service.update({ sessionId: CONTINUATION, hidden: true })
    store.set({
      sessionMeta: {
        ...store.get().sessionMeta,
        'de-otra-carpeta': { title: 'Vieja', updatedAt: '2026-01-01T00:00:00.000Z' }
      }
    })
    expect(service.metaStats()).toEqual({ entries: 3, orphaned: 1, favorites: 1, hidden: 1 })

    clearIndex(db)
    await runPass(db, claudeDir, quiet)
    expect(service.session(NUBE_RECENT)).toMatchObject({ title: 'Guardada', favorite: true })
    expect(service.session(CONTINUATION)).toMatchObject({ hidden: true })
    expect(store.get().sessionMeta['de-otra-carpeta']).toBeDefined()
  })

  it('sin índice: update → null y metaStats cuenta todo como huérfano', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bitacora-meta-'))
    dirs.push(root)
    const store = createAppStore(join(root, 'state.json'), quiet)
    store.set({ sessionMeta: { a: { hidden: true, updatedAt: 'x' } } })
    const service = createProjectsService({ store, reader: null, claudeDir: () => root })
    expect(service.update({ sessionId: 'a', title: 'x' })).toBeNull()
    expect(service.metaStats()).toEqual({ entries: 1, orphaned: 1, favorites: 0, hidden: 1 })
  })
})

describe('sessions:update (zod)', () => {
  const input = invokeContract['sessions:update'].input

  it.each([
    ['solo el id', { sessionId: 'x' }],
    ['un campo desconocido', { sessionId: 'x', tags: ['a'] }],
    ['un título de más de 200', { sessionId: 'x', title: 'a'.repeat(201) }],
    ['una favorita no booleana', { sessionId: 'x', favorite: 'sí' }]
  ])('rechaza %s', (_, patch) => {
    expect(input.safeParse(patch).success).toBe(false)
  })

  it('acepta título null (volver al calculado) y cada campo suelto', () => {
    expect(input.safeParse({ sessionId: 'x', title: null }).success).toBe(true)
    expect(input.safeParse({ sessionId: 'x', hidden: false }).success).toBe(true)
  })

  it('`forget` borra los datos propios de conversaciones eliminadas y deja el resto', async () => {
    const { store, service } = await setup()
    service.update({ sessionId: CONTINUATION, favorite: true })
    service.update({ sessionId: NUBE_RECENT, hidden: true })
    service.forget([ORIGIN, 'otra'])
    expect(Object.keys(store.get().sessionMeta)).toEqual([NUBE_RECENT])
  })
})

describe('aspecto y carpetas de las sesiones', () => {
  it('icono y color se guardan por conversación y se ven en lista y ficha; null los quita', async () => {
    const { store, service, nube } = await setup()
    const item = service.update({ sessionId: CONTINUATION, icon: 'rocket', color: 'teal' })
    expect(item).toMatchObject({ icon: 'rocket', color: 'teal' })
    expect(store.get().sessionMeta[ORIGIN]).toMatchObject({ icon: 'rocket', color: 'teal' })
    expect(service.sessions(nube).find((s) => s.sessionId === CONTINUATION)).toMatchObject({
      icon: 'rocket',
      color: 'teal'
    })
    expect(service.session(CONTINUATION)).toMatchObject({ icon: 'rocket' })
    service.update({ sessionId: CONTINUATION, icon: null })
    expect(service.session(CONTINUATION)?.icon).toBeUndefined()
    service.update({ sessionId: CONTINUATION, color: null })
    // Sin datos, la entrada no se guarda.
    expect(store.get().sessionMeta).toEqual({})
  })

  it('crear, editar y listar carpetas por proyecto', async () => {
    const { store, service, nube } = await setup()
    const folder = service.createFolder({ projectId: nube, name: '  Migración auth  ' })
    expect(folder).toMatchObject({ projectId: nube, name: 'Migración auth', context: '' })
    expect(service.folders(nube)).toEqual([folder])
    expect(service.folders('00000000-0000-4000-8000-000000000000')).toEqual([])
    const edited = service.updateFolder({
      id: folder.id,
      icon: 'shield',
      color: 'red',
      context: '# Tarea',
      collapsed: true
    })
    expect(edited).toMatchObject({
      icon: 'shield',
      color: 'red',
      context: '# Tarea',
      collapsed: true
    })
    const cleared = service.updateFolder({ id: folder.id, icon: null, collapsed: false })
    expect(cleared.icon).toBeUndefined()
    expect(cleared.collapsed).toBeUndefined()
    expect(store.get().sessionFolders).toHaveLength(1)
    expect(() => service.updateFolder({ id: folder.id, name: '   ' })).toThrow()
    expect(() =>
      service.createFolder({ projectId: '00000000-0000-4000-8000-000000000000', name: 'X' })
    ).toThrow()
  })

  it('meter y sacar sesiones; la carpeta solo vale en su proyecto', async () => {
    const { store, service, nube } = await setup()
    const folder = service.createFolder({ projectId: nube, name: 'Tarea' })
    service.update({ sessionId: CONTINUATION, folderId: folder.id })
    expect(service.sessions(nube).find((s) => s.sessionId === CONTINUATION)?.folderId).toBe(
      folder.id
    )
    expect(() =>
      service.update({ sessionId: NUBE_RECENT, folderId: '00000000-0000-4000-8000-000000000000' })
    ).toThrow()
    // Una carpeta de otro proyecto no se aplica en la lista.
    store.set({
      sessionFolders: store
        .get()
        .sessionFolders.map((f) => ({ ...f, projectId: '00000000-0000-4000-8000-000000000000' }))
    })
    expect(service.sessions(nube).find((s) => s.sessionId === CONTINUATION)?.folderId).toBe(
      undefined
    )
    service.update({ sessionId: CONTINUATION, folderId: null })
    expect(store.get().sessionMeta).toEqual({})
  })

  it('eliminar la carpeta deja sus sesiones sin carpeta y conserva lo demás', async () => {
    const { store, service, nube } = await setup()
    const folder = service.createFolder({ projectId: nube, name: 'Tarea' })
    service.update({ sessionId: CONTINUATION, folderId: folder.id, favorite: true })
    service.update({ sessionId: NUBE_RECENT, folderId: folder.id })
    service.removeFolder(folder.id)
    expect(store.get().sessionFolders).toEqual([])
    expect(store.get().sessionMeta[ORIGIN]).toMatchObject({ favorite: true })
    expect(store.get().sessionMeta[ORIGIN]?.folderId).toBeUndefined()
    expect(store.get().sessionMeta[NUBE_RECENT]).toBeUndefined()
  })

  it('assignFolder (sesión nueva) y clearFolders (mover a otro proyecto)', async () => {
    const { store, service, nube } = await setup()
    const folder = service.createFolder({ projectId: nube, name: 'Tarea' })
    service.assignFolder('sesion-nueva', folder.id)
    service.assignFolder('otra', '00000000-0000-4000-8000-000000000000')
    expect(store.get().sessionMeta['sesion-nueva']?.folderId).toBe(folder.id)
    expect(store.get().sessionMeta['otra']).toBeUndefined()
    expect(service.conversationsOf([CONTINUATION, 'no-existe'])).toEqual([ORIGIN])
    service.update({ sessionId: CONTINUATION, folderId: folder.id, icon: 'bot' })
    service.clearFolders([ORIGIN, 'sesion-nueva'])
    expect(store.get().sessionMeta[ORIGIN]).toMatchObject({ icon: 'bot' })
    expect(store.get().sessionMeta[ORIGIN]?.folderId).toBeUndefined()
    expect(store.get().sessionMeta['sesion-nueva']).toBeUndefined()
  })

  it('validación zod de sessions:update y folders:*', () => {
    const update = invokeContract['sessions:update'].input
    expect(update.safeParse({ sessionId: 'x', icon: 'rocket' }).success).toBe(true)
    expect(update.safeParse({ sessionId: 'x', icon: 'nope' }).success).toBe(false)
    expect(update.safeParse({ sessionId: 'x', folderId: 'no-uuid' }).success).toBe(false)
    expect(update.safeParse({ sessionId: 'x', folderId: null }).success).toBe(true)
    const create = invokeContract['folders:create'].input
    expect(
      create.safeParse({ projectId: '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f', name: ' ' }).success
    ).toBe(false)
    expect(
      create.safeParse({
        projectId: '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f',
        name: 'A',
        context: 'x'.repeat(20_001)
      }).success
    ).toBe(false)
  })
})
