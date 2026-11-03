import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ProjectColor, ProjectIcon, SessionFolder } from '../../../shared/types'
import { router } from '../router'
import { useProjectsStore } from './projects'
import { useSessionsStore } from './sessions'
import { useUiStore } from './ui'

/**
 * Carpetas de sesiones del proyecto activo (datos propios en `state.json`). Se recargan al
 * cambiar de proyecto y con la lista de sesiones. También guarda la carpeta en la que nacerá la
 * próxima sesión nueva y qué carpeta hay que enseñar (búsqueda).
 */
export const useFoldersStore = defineStore('folders', () => {
  const projects = useProjectsStore()
  const sessions = useSessionsStore()
  const ui = useUiStore()

  const items = ref<SessionFolder[]>([])
  const error = ref<string | null>(null)
  let ticket = 0

  async function load(): Promise<void> {
    const projectId = projects.activeId
    const mine = ++ticket
    if (!projectId) {
      items.value = []
      return
    }
    const result = await window.api.folders.list(projectId)
    if (mine !== ticket) return
    if (result.ok) {
      items.value = result.data
      error.value = null
    } else {
      error.value = result.error.message
    }
  }

  watch(
    () => projects.activeId,
    () => {
      items.value = []
      void load()
    },
    { immediate: true }
  )
  // La lista de sesiones se recarga tras cada cambio: las carpetas con ella.
  watch(
    () => sessions.items,
    () => void load()
  )

  function byId(id: string | null | undefined): SessionFolder | null {
    return id ? (items.value.find((f) => f.id === id) ?? null) : null
  }

  function fail(message: string): void {
    error.value = message
    ui.toast(message, { tone: 'danger' })
  }

  async function create(input: {
    name: string
    icon?: ProjectIcon | null
    color?: ProjectColor | null
    context?: string
  }): Promise<SessionFolder | null> {
    const projectId = projects.activeId
    if (!projectId) return null
    const result = await window.api.folders.create({
      projectId,
      name: input.name,
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.color ? { color: input.color } : {}),
      ...(input.context ? { context: input.context } : {})
    })
    if (!result.ok) {
      fail(result.error.message)
      return null
    }
    await load()
    return result.data
  }

  async function update(input: {
    id: string
    name?: string
    icon?: ProjectIcon | null
    color?: ProjectColor | null
    context?: string
    collapsed?: boolean
  }): Promise<boolean> {
    const result = await window.api.folders.update(input)
    if (!result.ok) {
      fail(result.error.message)
      await load()
      return false
    }
    items.value = items.value.map((f) => (f.id === input.id ? result.data : f))
    return true
  }

  /** Plegar o desplegar: se cambia al momento y se guarda después. */
  function toggle(id: string): void {
    const folder = byId(id)
    if (!folder) return
    const collapsed = !folder.collapsed
    items.value = items.value.map((f) => {
      if (f.id !== id) return f
      const next = { ...f }
      if (collapsed) next.collapsed = true
      else delete next.collapsed
      return next
    })
    void update({ id, collapsed })
  }

  async function remove(id: string): Promise<void> {
    const result = await window.api.folders.remove(id)
    if (!result.ok) return fail(result.error.message)
    if (nextFolderId.value === id) nextFolderId.value = null
    await sessions.load()
    await load()
  }

  // --- Diálogos ------------------------------------------------------
  /** Carpeta que se edita, `'new'` para crear una, o `null`. */
  const editing = ref<SessionFolder | 'new' | null>(null)
  /** Sesiones que se meterán en la carpeta que se cree con el diálogo. */
  const createWith = ref<string[]>([])
  /** Carpeta que espera la confirmación de «Eliminar…». */
  const removing = ref<SessionFolder | null>(null)

  function startCreate(sessionIds: readonly string[] = []): void {
    createWith.value = [...sessionIds]
    editing.value = 'new'
  }

  function startEdit(folder: SessionFolder): void {
    editing.value = folder
  }

  // --- Sesión nueva en una carpeta ----------------------------------
  /** Carpeta de la próxima sesión nueva (bienvenida). Se olvida al cambiar de proyecto. */
  const nextFolderId = ref<string | null>(null)
  const nextFolder = computed(() => byId(nextFolderId.value))
  watch(
    () => projects.activeId,
    () => (nextFolderId.value = null)
  )

  function newSessionIn(folderId: string): void {
    nextFolderId.value = folderId
    void router.push('/')
  }

  // --- Mostrar una carpeta (búsqueda) -------------------------------
  /** Carpeta que la lista tiene que desplegar y enseñar; la lista la limpia al hacerlo. */
  const revealId = ref<string | null>(null)

  async function reveal(folder: Pick<SessionFolder, 'id' | 'projectId'>): Promise<void> {
    if (projects.activeId !== folder.projectId) await projects.select(folder.projectId)
    await load()
    if (byId(folder.id)?.collapsed) toggle(folder.id)
    revealId.value = folder.id
  }

  return {
    items,
    error,
    load,
    byId,
    create,
    update,
    toggle,
    remove,
    editing,
    createWith,
    removing,
    startCreate,
    startEdit,
    nextFolderId,
    nextFolder,
    newSessionIn,
    revealId,
    reveal
  }
})
