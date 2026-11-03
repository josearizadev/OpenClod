import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  DiscoveredProject,
  ProjectView,
  SessionDetail,
  SessionListItem,
  SessionMetaStats
} from '../../shared/projects'
import type {
  Project,
  ProjectColor,
  ProjectIcon,
  SessionFolder,
  SessionMeta
} from '../../shared/types'
import type { AppStore } from './app-store'
import {
  conversationOf,
  countIndexedConversations,
  discover,
  getSession,
  listSessions,
  projectStats,
  type IndexedDetail,
  type IndexedListItem
} from './index-queries'
import { isInside, normalizePath, pathKey } from './paths'
import { t } from '../i18n'

/**
 * Proyectos importados sobre `state.json` y el lector del índice. Nunca
 * toca la carpeta del proyecto ni la de Claude Code: solo `stat` para saber si existen.
 */

/** Rechazo previsto; la capa IPC lo traduce a `IpcError`. */
export class ProjectError extends Error {
  constructor(
    readonly code: 'INVALID_CWD' | 'NOT_FOUND' | 'PROTECTED',
    message: string
  ) {
    super(message)
    this.name = 'ProjectError'
  }
}

export interface ProjectsServiceOptions {
  store: AppStore
  /** Lector del índice, o `null` si no se pudo abrir (los proyectos siguen funcionando). */
  reader: Database.Database | null
  claudeDir: () => string
  /** Carpeta personal: con ella existe siempre «Mi PC». Sin ella (tests), no hay «Mi PC». */
  home?: () => string
  now?: () => Date
}

/** Nombre, icono y color de un proyecto; `null` vuelve al valor por defecto. */
export interface ProjectCustomization {
  id: string
  name?: string | null
  icon?: ProjectIcon | null
  color?: ProjectColor | null
}

export interface ProjectsService {
  list(): Promise<ProjectView[]>
  import(path: string): Promise<ProjectView>
  importMany(paths: string[]): Promise<ProjectView[]>
  remove(id: string): void
  customize(input: ProjectCustomization): Promise<ProjectView>
  select(id: string): void
  active(): string | null
  discover(): DiscoveredProject[]
  sessions(projectId: string): SessionListItem[]
  session(sessionId: string): SessionDetail | null
  /** Datos propios de la conversación de `sessionId`. */
  update(patch: SessionPatch): SessionListItem | null
  /** Borra los datos propios de conversaciones eliminadas. */
  forget(conversationIds: readonly string[]): void
  metaStats(): SessionMetaStats
  /** Conversaciones de esas sesiones (las que estén en el índice). */
  conversationsOf(sessionIds: readonly string[]): string[]
  /** Mete una sesión recién creada en una carpeta (aún no está en el índice). */
  assignFolder(conversationId: string, folderId: string): void
  /** Saca de su carpeta esas conversaciones (p. ej. al moverlas a otro proyecto). */
  clearFolders(conversationIds: readonly string[]): void
  folders(projectId: string): SessionFolder[]
  createFolder(input: FolderCreate): SessionFolder
  updateFolder(input: FolderPatch): SessionFolder
  /** Elimina la carpeta; sus sesiones se quedan sin carpeta. */
  removeFolder(id: string): void
}

export interface FolderCreate {
  projectId: string
  name: string
  icon?: ProjectIcon | undefined
  color?: ProjectColor | undefined
  context?: string | undefined
}

/** `null` en icono o color lo quita. */
export interface FolderPatch {
  id: string
  name?: string | undefined
  icon?: ProjectIcon | null | undefined
  color?: ProjectColor | null | undefined
  context?: string | undefined
  collapsed?: boolean | undefined
}

/** `title` vacío o `null` vuelve al título calculado; `null` en el resto, lo quita. */
export interface SessionPatch {
  sessionId: string
  title?: string | null | undefined
  favorite?: boolean | undefined
  hidden?: boolean | undefined
  icon?: ProjectIcon | null | undefined
  color?: ProjectColor | null | undefined
  folderId?: string | null | undefined
}

type MetaPatch = Omit<SessionPatch, 'sessionId'>

type Looks = { favorite: boolean; hidden: boolean } & Pick<
  SessionListItem,
  'icon' | 'color' | 'folderId'
>

/**
 * Aplica los datos propios a una entrada del índice y quita `conversationId`. `folderOk` dice si
 * la carpeta guardada vale aquí (existe y es del proyecto que se lista).
 */
function withMeta<T extends IndexedListItem | IndexedDetail>(
  item: T,
  meta: SessionMeta | undefined,
  folderOk: (folderId: string) => boolean
): Omit<T, 'conversationId'> & Looks {
  const out: Omit<T, 'conversationId'> & Looks & { conversationId?: string } = {
    ...item,
    favorite: meta?.favorite === true,
    hidden: meta?.hidden === true,
    ...(meta?.icon ? { icon: meta.icon } : {}),
    ...(meta?.color ? { color: meta.color } : {}),
    ...(meta?.folderId && folderOk(meta.folderId) ? { folderId: meta.folderId } : {})
  }
  delete out.conversationId
  if (meta?.title) {
    out.title = meta.title
    if ('titleSource' in out) out.titleSource = 'app'
  } else if (out.title === '(sin título)') {
    // El índice guarda el título de respaldo en español.
    out.title = t('(sin título)')
  }
  return out
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Nombre por defecto: «Mi PC» o el de la carpeta. */
function defaultName(project: Pick<Project, 'path' | 'kind'>): string {
  return project.kind === 'computer' ? t('Mi PC') : basename(project.path) || project.path
}

function byRecent(a: Project, b: Project): number {
  return b.lastOpenedAt.localeCompare(a.lastOpenedAt)
}

/** Nombre de carpeta: sin espacios a los lados y con un máximo de 100 caracteres. */
function cleanName(name: string): string {
  const clean = name.trim().slice(0, 100)
  if (!clean) throw new ProjectError('NOT_FOUND', t('La carpeta necesita un nombre.'))
  return clean
}

/** `all` con la entrada `conversationId` cambiada; una entrada sin datos se borra. */
function metaWith(
  all: Record<string, SessionMeta>,
  conversationId: string,
  patch: MetaPatch,
  at: string
): Record<string, SessionMeta> {
  const current = all[conversationId]
  const next: Partial<SessionMeta> = {}
  const title = patch.title === undefined ? current?.title : patch.title?.trim()
  if (title) next.title = title.slice(0, 200)
  if (patch.favorite ?? current?.favorite === true) next.favorite = true
  if (patch.hidden ?? current?.hidden === true) next.hidden = true
  const icon = patch.icon === undefined ? current?.icon : patch.icon
  if (icon) next.icon = icon
  const color = patch.color === undefined ? current?.color : patch.color
  if (color) next.color = color
  const folderId = patch.folderId === undefined ? current?.folderId : patch.folderId
  if (folderId) next.folderId = folderId
  const rest = Object.fromEntries(Object.entries(all).filter(([key]) => key !== conversationId))
  return Object.keys(next).length > 0
    ? { ...rest, [conversationId]: { ...next, updatedAt: at } }
    : rest
}

export function createProjectsService(options: ProjectsServiceOptions): ProjectsService {
  const { store, reader } = options
  const now = (): string => (options.now?.() ?? new Date()).toISOString()

  /** Aplica `patch` a los datos propios de la conversación, lo guarda y devuelve el total. */
  function writeMeta(conversationId: string, patch: MetaPatch): Record<string, SessionMeta> {
    const sessionMeta = metaWith(store.get().sessionMeta, conversationId, patch, now())
    store.set({ sessionMeta })
    return sessionMeta
  }

  /** La carpeta existe (la lista, además, solo acepta las de su proyecto). */
  function folderExists(folderId: string): boolean {
    return store.get().sessionFolders.some((f) => f.id === folderId)
  }

  function projects(): Project[] {
    return store.get().projects
  }

  function find(id: string): Project {
    const project = projects().find((p) => p.id === id)
    if (!project) throw new ProjectError('NOT_FOUND', t('El proyecto no existe.'))
    return project
  }

  async function view(project: Project): Promise<ProjectView> {
    const stats = reader ? projectStats(reader, [pathKey(project.path)]) : new Map()
    return toView(project, stats.get(pathKey(project.path)), !(await isDirectory(project.path)))
  }

  function toView(
    project: Project,
    stats: { sessionCount: number; lastActivityAt: string | null } | undefined,
    missing: boolean
  ): ProjectView {
    return {
      ...project,
      sessionCount: stats?.sessionCount ?? 0,
      lastActivityAt: stats?.lastActivityAt ?? null,
      missing
    }
  }

  /** Marca `id` como activo y actualiza su fecha de último uso. */
  function activate(id: string): Project {
    const at = now()
    const updated = projects().map((p) => (p.id === id ? { ...p, lastOpenedAt: at } : p))
    store.set({ projects: updated, activeProjectId: id })
    return find(id)
  }

  /** Valida y añade (o encuentra) un proyecto sin activarlo. */
  async function add(raw: string): Promise<Project> {
    const path = normalizePath(raw)
    if (path === '' || !(await isDirectory(path))) {
      throw new ProjectError('INVALID_CWD', t('La carpeta no existe.'))
    }
    if (isInside(path, options.claudeDir())) {
      throw new ProjectError('INVALID_CWD', t('No se puede importar la carpeta de Claude Code.'))
    }
    const key = pathKey(path)
    const existing = projects().find((p) => pathKey(p.path) === key)
    if (existing) return existing
    const at = now()
    const project: Project = {
      id: randomUUID(),
      path,
      name: defaultName({ path }),
      addedAt: at,
      lastOpenedAt: at
    }
    store.set({ projects: [...projects(), project] })
    return project
  }

  /** «Mi PC»: la carpeta personal como proyecto. Si ya estaba importada, se convierte. */
  function ensureComputer(): void {
    const raw = options.home?.()
    if (!raw) return
    const path = normalizePath(raw)
    if (path === '' || isInside(path, options.claudeDir())) return
    const all = projects()
    const key = pathKey(path)
    const existing = all.find((p) => pathKey(p.path) === key)
    if (existing?.kind === 'computer' && all.filter((p) => p.kind === 'computer').length === 1) {
      return
    }
    // Solo uno: si la carpeta personal cambió, el anterior vuelve a ser un proyecto normal.
    const rest = all.map((p) => {
      if (p.kind !== 'computer' || p === existing) return p
      const folder: Project = { ...p }
      delete folder.kind
      return folder
    })
    if (existing) {
      store.set({
        projects: rest.map((p) =>
          p === existing
            ? {
                ...p,
                kind: 'computer',
                name: p.name === defaultName(p) ? t('Mi PC') : p.name,
                icon: p.icon ?? 'monitor'
              }
            : p
        )
      })
      return
    }
    const at = now()
    const computer: Project = {
      id: randomUUID(),
      path,
      name: t('Mi PC'),
      kind: 'computer',
      icon: 'monitor',
      addedAt: at,
      lastOpenedAt: at
    }
    store.set({ projects: [...rest, computer] })
  }

  ensureComputer()

  return {
    async list() {
      const all = [...projects()].sort(byRecent)
      const stats = reader
        ? projectStats(
            reader,
            all.map((p) => pathKey(p.path))
          )
        : new Map()
      const missing = await Promise.all(all.map(async (p) => !(await isDirectory(p.path))))
      return all.map((p, i) => toView(p, stats.get(pathKey(p.path)), missing[i] ?? false))
    },

    async import(path) {
      const project = await add(path)
      return view(activate(project.id))
    },

    async importMany(paths) {
      const added: Project[] = []
      let firstError: unknown = null
      for (const path of paths) {
        try {
          const project = await add(path)
          if (!added.some((p) => p.id === project.id)) added.push(project)
        } catch (error) {
          firstError ??= error
        }
      }
      const [first] = added
      if (!first) throw firstError ?? new ProjectError('INVALID_CWD', t('La carpeta no existe.'))
      activate(first.id)
      return Promise.all(added.map((p) => view(find(p.id))))
    },

    remove(id) {
      if (find(id).kind === 'computer') {
        throw new ProjectError('PROTECTED', t('Mi PC no se puede quitar.'))
      }
      const rest = projects().filter((p) => p.id !== id)
      const state = store.get()
      const active =
        state.activeProjectId === id
          ? ([...rest].sort(byRecent)[0]?.id ?? null)
          : state.activeProjectId
      store.set({ projects: rest, activeProjectId: active })
    },

    async customize({ id, name, icon, color }) {
      const project = find(id)
      const next: Project = { ...project }
      if (name !== undefined) next.name = (name?.trim() || defaultName(project)).slice(0, 256)
      if (icon !== undefined) {
        if (icon) next.icon = icon
        else delete next.icon
      }
      if (color !== undefined) {
        if (color) next.color = color
        else delete next.color
      }
      store.set({ projects: projects().map((p) => (p.id === id ? next : p)) })
      return view(next)
    },

    select(id) {
      find(id)
      activate(id)
    },

    active() {
      const id = store.get().activeProjectId
      return id && projects().some((p) => p.id === id) ? id : null
    },

    discover() {
      if (!reader) return []
      return discover(
        reader,
        projects().map((p) => pathKey(p.path))
      )
    },

    sessions(projectId) {
      const project = projects().find((p) => p.id === projectId)
      if (!project || !reader) return []
      const state = store.get()
      const mine = new Set(
        state.sessionFolders.filter((f) => f.projectId === projectId).map((f) => f.id)
      )
      return listSessions(reader, pathKey(project.path)).map((item) =>
        withMeta(item, state.sessionMeta[item.conversationId], (id) => mine.has(id))
      )
    },

    session(sessionId) {
      const detail = reader ? getSession(reader, sessionId) : null
      return detail
        ? withMeta(detail, store.get().sessionMeta[detail.conversationId], folderExists)
        : null
    },

    update({ sessionId, ...patch }) {
      if (!reader) return null
      const conversationId = conversationOf(reader, sessionId)
      if (!conversationId) return null
      if (patch.folderId && !folderExists(patch.folderId)) {
        throw new ProjectError('NOT_FOUND', t('La carpeta no existe.'))
      }
      const sessionMeta = writeMeta(conversationId, patch)
      const detail = getSession(reader, sessionId)
      if (!detail) return null
      const {
        sessionId: id,
        title,
        startedAt,
        updatedAt,
        gitBranch,
        usage,
        chainLength,
        favorite,
        hidden,
        icon,
        color,
        folderId
      } = withMeta(detail, sessionMeta[conversationId], folderExists)
      return {
        sessionId: id,
        title,
        ...(startedAt ? { startedAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...(gitBranch ? { gitBranch } : {}),
        usage,
        chainLength,
        favorite,
        hidden,
        ...(icon ? { icon } : {}),
        ...(color ? { color } : {}),
        ...(folderId ? { folderId } : {})
      }
    },

    conversationsOf(sessionIds) {
      if (!reader) return []
      const out = new Set<string>()
      for (const id of sessionIds) {
        const conversationId = conversationOf(reader, id)
        if (conversationId) out.add(conversationId)
      }
      return [...out]
    },

    assignFolder(conversationId, folderId) {
      if (folderExists(folderId)) writeMeta(conversationId, { folderId })
    },

    clearFolders(conversationIds) {
      const all = store.get().sessionMeta
      const ids = conversationIds.filter((id) => all[id]?.folderId)
      if (ids.length === 0) return
      let next = all
      for (const id of ids) next = metaWith(next, id, { folderId: null }, now())
      store.set({ sessionMeta: next })
    },

    folders(projectId) {
      return store.get().sessionFolders.filter((f) => f.projectId === projectId)
    },

    createFolder({ projectId, name, icon, color, context }) {
      find(projectId)
      const folder: SessionFolder = {
        id: randomUUID(),
        projectId,
        name: cleanName(name),
        ...(icon ? { icon } : {}),
        ...(color ? { color } : {}),
        context: context ?? '',
        createdAt: now()
      }
      store.set({ sessionFolders: [...store.get().sessionFolders, folder] })
      return folder
    },

    updateFolder({ id, name, icon, color, context, collapsed }) {
      const all = store.get().sessionFolders
      const current = all.find((f) => f.id === id)
      if (!current) throw new ProjectError('NOT_FOUND', t('La carpeta no existe.'))
      const next: SessionFolder = { ...current }
      if (name !== undefined) next.name = cleanName(name)
      if (icon !== undefined) {
        if (icon) next.icon = icon
        else delete next.icon
      }
      if (color !== undefined) {
        if (color) next.color = color
        else delete next.color
      }
      if (context !== undefined) next.context = context
      if (collapsed !== undefined) {
        if (collapsed) next.collapsed = true
        else delete next.collapsed
      }
      store.set({ sessionFolders: all.map((f) => (f.id === id ? next : f)) })
      return next
    },

    removeFolder(id) {
      const state = store.get()
      if (!state.sessionFolders.some((f) => f.id === id)) return
      let meta = state.sessionMeta
      for (const [key, m] of Object.entries(meta)) {
        if (m.folderId === id) meta = metaWith(meta, key, { folderId: null }, now())
      }
      store.set({
        sessionFolders: state.sessionFolders.filter((f) => f.id !== id),
        sessionMeta: meta
      })
    },

    forget(conversationIds) {
      const gone = new Set(conversationIds)
      const all = store.get().sessionMeta
      if (!Object.keys(all).some((key) => gone.has(key))) return
      store.set({
        sessionMeta: Object.fromEntries(Object.entries(all).filter(([key]) => !gone.has(key)))
      })
    },

    metaStats() {
      const entries = Object.entries(store.get().sessionMeta)
      const indexed = reader
        ? countIndexedConversations(
            reader,
            entries.map(([key]) => key)
          )
        : 0
      return {
        entries: entries.length,
        orphaned: entries.length - indexed,
        favorites: entries.filter(([, m]) => m.favorite).length,
        hidden: entries.filter(([, m]) => m.hidden).length
      }
    }
  }
}
