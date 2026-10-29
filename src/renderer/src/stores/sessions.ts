import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  IndexStatus,
  IndexUpdated,
  SessionListItem,
  SessionTrashResult
} from '../../../shared/projects'
import { useLiveClock } from '../composables/useLiveClock'
import { router } from '../router'
import { useProjectsStore } from './projects'

/**
 * Lista de sesiones del proyecto activo y estado del índice. Se recarga al
 * cambiar de proyecto y cuando una pasada del índice cambia algo (`index:updated`).
 */
export const useSessionsStore = defineStore('sessions', () => {
  const projects = useProjectsStore()
  const items = ref<SessionListItem[]>([])
  const status = ref<IndexStatus | null>(null)
  /** Hay una carga de la lista en curso. */
  const loading = ref(false)
  /** La lista del proyecto activo ya se pidió al menos una vez. */
  const loaded = ref(false)
  const error = ref<string | null>(null)
  /** «Actualizar» pulsado y aún sin respuesta. */
  const refreshing = ref(false)

  let request = 0
  /** Reloj de la marca «en vivo»: se adelanta al siguiente vencimiento. */
  const clock = useLiveClock(() => items.value.map((i) => i.lastWriteAt))

  async function load(): Promise<void> {
    const projectId = projects.activeId
    const ticket = ++request
    if (!projectId) {
      items.value = []
      loaded.value = false
      return
    }
    loading.value = true
    const result = await window.api.sessions.list(projectId)
    // Una respuesta de un proyecto anterior no pisa la del actual.
    if (ticket !== request) return
    loading.value = false
    loaded.value = true
    if (result.ok) {
      // Marca de rendimiento: primera lista recibida del main.
      if (!performance.getEntriesByName('bitacora:lista-respondida').length) {
        performance.mark('bitacora:lista-respondida')
      }
      items.value = result.data
      error.value = null
      // La selección no conserva entradas que ya no están.
      const present = new Set(result.data.map((i) => i.sessionId))
      if (selected.value.some((id) => !present.has(id)))
        selected.value = selected.value.filter((id) => present.has(id))
    } else {
      error.value = result.error.message
    }
  }

  async function loadStatus(): Promise<void> {
    const result = await window.api.index.status()
    if (result.ok) status.value = result.data
  }

  async function refresh(): Promise<void> {
    refreshing.value = true
    const result = await window.api.index.refresh()
    refreshing.value = false
    if (!result.ok) error.value = result.error.message
  }

  /** Lo llama `App.vue` con cada `index:updated`. */
  function onIndexUpdated(event: IndexUpdated): void {
    status.value = event.status
    if (event.changed) {
      void load()
      void projects.load()
    }
  }

  // Al cambiar de proyecto: lista nueva y, si había una sesión abierta de otro, vuelta al inicio.
  watch(
    () => projects.activeId,
    async (id, previous) => {
      items.value = []
      clearSelection()
      loaded.value = false
      await load()
      const route = router.currentRoute.value
      if (previous !== undefined && route.name === 'session' && id !== previous) {
        const open = String(route.params['id'] ?? '')
        if (!items.value.some((i) => i.sessionId === open)) void router.push('/')
      }
    }
  )

  /** «Archivadas (N)» desplegado en la lista: preferencia de esta ejecución, no se guarda. */
  const showHidden = ref(false)

  /**
   * Renombrar, favorita o archivar (`hidden`). Recarga la lista; la vista abierta recarga su
   * cabecera al cambiar la lista. `title: null` o vacío vuelve al título calculado.
   */
  async function update(
    sessionId: string,
    patch: { title?: string | null; favorite?: boolean; hidden?: boolean }
  ): Promise<SessionListItem | null> {
    const result = await window.api.sessions.update({ sessionId, ...patch })
    await load()
    if (!result.ok) {
      error.value = result.error.message
      return null
    }
    return result.data
  }

  /** Sesión que se está renombrando: la app tiene un solo diálogo (`RenameSessionDialog`). */
  const renaming = ref<{ sessionId: string; title: string } | null>(null)

  function startRename(sessionId: string, title: string): void {
    renaming.value = { sessionId, title }
  }

  // --- Selección múltiple y papelera -----------------------------
  const selected = ref<string[]>([])
  /** Última fila marcada: un extremo del rango de `Mayús+clic`. */
  let anchor: string | null = null
  const selecting = computed(() => selected.value.length > 0)

  function isSelected(sessionId: string): boolean {
    return selected.value.includes(sessionId)
  }

  function toggleSelect(sessionId: string): void {
    selected.value = isSelected(sessionId)
      ? selected.value.filter((id) => id !== sessionId)
      : [...selected.value, sessionId]
    anchor = sessionId
  }

  /**
   * `order`: ids en el orden en que se ven en la lista. Sin ancla, el rango empieza en la sesión
   * abierta, como en un explorador de archivos: clic en una y `Mayús+clic` en otra.
   */
  function selectRange(sessionId: string, order: readonly string[]): void {
    const route = router.currentRoute.value
    const open = route.name === 'session' ? String(route.params['id'] ?? '') : null
    const start = anchor ?? open
    const from = start ? order.indexOf(start) : -1
    const to = order.indexOf(sessionId)
    if (from === -1 || to === -1) return toggleSelect(sessionId)
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
    selected.value = [...new Set([...selected.value, ...range])]
    anchor = start
  }

  function selectAll(order: readonly string[]): void {
    selected.value = [...order]
  }

  function clearSelection(): void {
    selected.value = []
    anchor = null
  }

  /** Archivar o desarchivar todas las seleccionadas de una vez. */
  async function setHiddenMany(sessionIds: readonly string[], hidden: boolean): Promise<void> {
    for (const sessionId of sessionIds) {
      const result = await window.api.sessions.update({ sessionId, hidden })
      if (!result.ok) error.value = result.error.message
    }
    // Cambian de grupo (o dejan de verse): la selección ya no tiene sentido.
    clearSelection()
    await load()
  }

  /** Marcar o quitar de favoritas varias a la vez; la selección se mantiene. */
  async function setFavoriteMany(sessionIds: readonly string[], favorite: boolean): Promise<void> {
    for (const sessionId of sessionIds) {
      const result = await window.api.sessions.update({ sessionId, favorite })
      if (!result.ok) error.value = result.error.message
    }
    await load()
  }

  /** Entradas que esperan la confirmación de «Eliminar…» (un solo diálogo, en `App.vue`). */
  const trashRequest = ref<string[] | null>(null)

  function askTrash(sessionIds: readonly string[]): void {
    if (sessionIds.length > 0) trashRequest.value = [...sessionIds]
  }

  /** Mueve a la papelera; el main ya ha refrescado el índice al responder. */
  async function trash(sessionIds: readonly string[]): Promise<SessionTrashResult | null> {
    const result = await window.api.sessions.trash([...sessionIds])
    if (!result.ok) {
      error.value = result.error.message
      return null
    }
    const gone = new Set(result.data.trashed)
    selected.value = selected.value.filter((id) => !gone.has(id))
    await load()
    // Si la sesión abierta era de una conversación eliminada, a la bienvenida.
    const route = router.currentRoute.value
    if (gone.size > 0 && route.name === 'session') {
      const open = await window.api.sessions.get(String(route.params['id'] ?? ''))
      if (open.ok && open.data === null) void router.push('/')
    }
    return result.data
  }

  return {
    selected,
    selecting,
    isSelected,
    toggleSelect,
    selectRange,
    selectAll,
    clearSelection,
    setHiddenMany,
    setFavoriteMany,
    trashRequest,
    askTrash,
    trash,
    items,
    clock,
    status,
    showHidden,
    update,
    renaming,
    startRename,
    loading,
    loaded,
    error,
    refreshing,
    load,
    loadStatus,
    refresh,
    onIndexUpdated
  }
})
