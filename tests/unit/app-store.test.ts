import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../src/main/services/app-store'
import { invokeContract } from '../../src/shared/ipc-contract'
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_STATE,
  DEFAULT_TERMINAL,
  type Project
} from '../../src/shared/types'

const project: Project = {
  id: '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f',
  path: 'Z:\\web\\Nube',
  name: 'Nube',
  addedAt: '2026-10-14T10:00:00.000Z',
  lastOpenedAt: '2026-10-14T10:00:00.000Z'
}

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bitacora-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AppStore', () => {
  it('sin archivo usa los valores por defecto sin avisar', () => {
    const warn = vi.fn()
    const store = createAppStore(join(tempDir(), 'state.json'), { warn })
    expect(store.get()).toEqual({ ...DEFAULT_STATE })
    expect(warn).not.toHaveBeenCalled()
  })

  it('persiste el tema y lo recupera en un store nuevo (reinicio)', () => {
    const file = join(tempDir(), 'sub', 'state.json')
    expect(createAppStore(file, { warn: vi.fn() }).set({ theme: 'dark' })).toEqual({
      ...DEFAULT_STATE,
      theme: 'dark'
    })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...DEFAULT_STATE, theme: 'dark' })
    expect(createAppStore(file, { warn: vi.fn() }).get()).toEqual({
      ...DEFAULT_STATE,
      theme: 'dark'
    })
  })

  it('no deja el archivo temporal tras escribir', () => {
    const file = join(tempDir(), 'state.json')
    createAppStore(file, { warn: vi.fn() }).set({ theme: 'light' })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('una clave undefined en el parche no borra el valor actual', () => {
    const store = createAppStore(join(tempDir(), 'state.json'), { warn: vi.fn() })
    store.set({ theme: 'dark' })
    expect(store.set({ theme: undefined })).toEqual({ ...DEFAULT_STATE, theme: 'dark' })
  })

  it('get() devuelve una copia', () => {
    const store = createAppStore(join(tempDir(), 'state.json'), { warn: vi.fn() })
    const copy = store.get()
    copy.theme = 'dark'
    expect(store.get().theme).toBe('system')
  })

  it.each([
    ['JSON roto', '{"theme": "dark"'],
    ['no es un objeto', '["dark"]'],
    ['valor no válido', '{"theme": "rosa"}']
  ])('con un state.json corrupto (%s) usa los valores por defecto y avisa', (_, content) => {
    const file = join(tempDir(), 'state.json')
    writeFileSync(file, content, 'utf8')
    const warn = vi.fn()
    expect(createAppStore(file, { warn }).get()).toEqual({ ...DEFAULT_STATE })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('completa claves que falten e ignora claves desconocidas', () => {
    const file = join(tempDir(), 'state.json')
    writeFileSync(file, '{"otra": 1}', 'utf8')
    expect(createAppStore(file, { warn: vi.fn() }).get()).toEqual({ ...DEFAULT_STATE })
  })

  it('si no puede escribir, lanza y conserva el valor anterior', () => {
    const dir = tempDir()
    const file = join(dir, 'state.json')
    const store = createAppStore(file, { warn: vi.fn() })
    // Un directorio con el nombre del destino hace fallar el rename.
    mkdirSync(file)
    expect(() => store.set({ theme: 'dark' })).toThrow()
    expect(store.get()).toEqual({ ...DEFAULT_STATE })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('completa un state.json sin proyectos con la lista vacía', () => {
    const file = join(tempDir(), 'state.json')
    writeFileSync(file, JSON.stringify({ theme: 'dark', claudeDir: 'D:\\claude' }), 'utf8')
    const warn = vi.fn()
    expect(createAppStore(file, { warn }).get()).toEqual({
      theme: 'dark',
      claudeDir: 'D:\\claude',
      viewer: { tools: true, thinking: true, internal: false },
      projects: [],
      activeProjectId: null,
      sessionMeta: {},
      chat: { model: null, permissionMode: 'default', filesPanel: false },
      chatCache: { models: [], commands: [], updatedAt: null },
      search: { scope: 'project' },
      usage: { period: '7d', scope: 'all', showCost: false, probe: true },
      notifications: { ...DEFAULT_NOTIFICATIONS },
      terminal: { ...DEFAULT_TERMINAL },
      window: { closeToTray: false },
      language: 'system',
      welcomed: false,
      limitsCache: null,
      windowState: null,
      projectPrefs: {},
      sessionMoves: {}
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('completa un state.json sin `sessionMeta` con `sessionMeta` vacío y los filtros por defecto', () => {
    const file = join(tempDir(), 'state.json')
    writeFileSync(
      file,
      JSON.stringify({
        theme: 'light',
        claudeDir: null,
        projects: [project],
        activeProjectId: project.id
      }),
      'utf8'
    )
    const warn = vi.fn()
    expect(createAppStore(file, { warn }).get()).toEqual({
      theme: 'light',
      claudeDir: null,
      viewer: { tools: true, thinking: true, internal: false },
      projects: [project],
      activeProjectId: project.id,
      sessionMeta: {},
      chat: { model: null, permissionMode: 'default', filesPanel: false },
      chatCache: { models: [], commands: [], updatedAt: null },
      search: { scope: 'project' },
      usage: { period: '7d', scope: 'all', showCost: false, probe: true },
      notifications: { ...DEFAULT_NOTIFICATIONS },
      terminal: { ...DEFAULT_TERMINAL },
      window: { closeToTray: false },
      language: 'system',
      welcomed: false,
      limitsCache: null,
      windowState: null,
      projectPrefs: {},
      sessionMoves: {}
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('completa un state.json sin preferencias del chat con las preferencias y la caché del chat', () => {
    const file = join(tempDir(), 'state.json')
    const phase3 = {
      theme: 'dark',
      claudeDir: null,
      viewer: { tools: false, thinking: true, internal: false },
      projects: [project],
      activeProjectId: project.id,
      sessionMeta: { abc: { title: 'Mío', updatedAt: 'x' } }
    }
    writeFileSync(file, JSON.stringify(phase3), 'utf8')
    const warn = vi.fn()
    expect(createAppStore(file, { warn }).get()).toEqual({
      ...phase3,
      chat: { model: null, permissionMode: 'default', filesPanel: false },
      chatCache: { models: [], commands: [], updatedAt: null },
      search: { scope: 'project' },
      usage: { period: '7d', scope: 'all', showCost: false, probe: true },
      notifications: { ...DEFAULT_NOTIFICATIONS },
      terminal: { ...DEFAULT_TERMINAL },
      window: { closeToTray: false },
      language: 'system',
      welcomed: false,
      limitsCache: null,
      windowState: null,
      projectPrefs: {},
      sessionMoves: {}
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('persiste las preferencias y la caché del chat', () => {
    const file = join(tempDir(), 'state.json')
    const chatCache = {
      models: [{ value: 'haiku', displayName: 'Haiku', description: 'Rápido' }],
      commands: [{ name: 'siguiente', description: 'Avanza' }],
      updatedAt: '2026-10-14T10:00:00.000Z'
    }
    createAppStore(file, { warn: vi.fn() }).set({
      chat: { model: 'haiku', permissionMode: 'acceptEdits', filesPanel: true },
      chatCache
    })
    expect(createAppStore(file, { warn: vi.fn() }).get()).toMatchObject({
      chat: { model: 'haiku', permissionMode: 'acceptEdits', filesPanel: true },
      chatCache
    })
  })

  it('persiste los filtros del visor y los datos propios', () => {
    const file = join(tempDir(), 'state.json')
    const meta = { abc: { title: 'Mío', favorite: true as const, updatedAt: 'x' } }
    createAppStore(file, { warn: vi.fn() }).set({
      viewer: { tools: false, thinking: true, internal: true },
      sessionMeta: meta
    })
    expect(createAppStore(file, { warn: vi.fn() }).get()).toMatchObject({
      viewer: { tools: false, thinking: true, internal: true },
      sessionMeta: meta
    })
  })

  it('persiste los proyectos y el activo', () => {
    const file = join(tempDir(), 'state.json')
    createAppStore(file, { warn: vi.fn() }).set({
      projects: [project],
      activeProjectId: project.id
    })
    expect(createAppStore(file, { warn: vi.fn() }).get()).toEqual({
      ...DEFAULT_STATE,
      projects: [project],
      activeProjectId: project.id
    })
  })

  it('get() devuelve una copia profunda de los proyectos', () => {
    const store = createAppStore(join(tempDir(), 'state.json'), { warn: vi.fn() })
    store.set({ projects: [project] })
    store.get().projects[0]!.name = 'Otro'
    store.get().projects.push({ ...project })
    expect(store.get().projects).toEqual([project])
  })

  it('rechaza un proyecto no válido sin cambiar el estado', () => {
    const store = createAppStore(join(tempDir(), 'state.json'), { warn: vi.fn() })
    expect(() => store.set({ projects: [{ ...project, id: 'no-es-uuid' }] })).toThrow()
    expect(store.get().projects).toEqual([])
  })
})

describe('settings:set', () => {
  const input = invokeContract['settings:set'].input

  it('acepta solo los ajustes', () => {
    expect(input.safeParse({ theme: 'dark' }).success).toBe(true)
    expect(
      input.safeParse({ viewer: { tools: true, thinking: false, internal: true } }).success
    ).toBe(true)
    expect(
      input.safeParse({ chat: { model: 'sonnet', permissionMode: 'plan', filesPanel: true } })
        .success
    ).toBe(true)
  })

  it.each([
    ['projects', { projects: [] }],
    ['sessionMeta', { sessionMeta: {} }],
    ['un filtro incompleto', { viewer: { tools: true } }],
    ['activeProjectId', { activeProjectId: null }],
    ['chatCache', { chatCache: { models: [], commands: [], updatedAt: null } }],
    [
      '«Saltar permisos» como preferencia',
      { chat: { model: null, permissionMode: 'bypassPermissions', filesPanel: false } }
    ]
  ])('rechaza %s (INVALID_ARGS)', (_, patch) => {
    expect(input.safeParse(patch).success).toBe(false)
  })
})
