import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { t } from '../i18n'
import { router } from '../router'
import { useChatStore } from './chat'
import { useProjectsStore } from './projects'
import { useSessionsStore } from './sessions'

/**
 * Pestañas de sesiones abiertas. La ruta manda: `/` es la pestaña vacía («Nueva sesión») y
 * `/sesion/:id` la de esa sesión; el store solo decide en qué pestaña cae cada navegación. Cerrar
 * una pestaña no detiene a Claude: el chat sigue en el store `chat`.
 */
export interface SessionTab {
  /** Clave local de la pestaña (no cambia aunque cambie su sesión). */
  key: string
  sessionId: string | null
  title: string
  projectId: string | null
}

const STORAGE_KEY = 'openclod.tabs'
/** Más pestañas que esto: se cierra la más antigua que no esté trabajando. */
const MAX_TABS = 20

type Status = 'working' | 'waiting' | 'done' | null

let counter = 0
function newKey(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter}`
}

/** Normaliza una ruta para compararla con la de un proyecto. */
function pathKey(path: string): string {
  return path
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

function restore(): SessionTab[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { sessionId, title, projectId } = item as Record<string, unknown>
      if (typeof sessionId !== 'string' || sessionId.length > 100) return []
      return [
        {
          key: newKey(),
          sessionId,
          title: typeof title === 'string' ? title.slice(0, 200) : t('Sesión'),
          projectId: typeof projectId === 'string' ? projectId : null
        }
      ]
    })
  } catch {
    return []
  }
}

export const useTabsStore = defineStore('tabs', () => {
  const chat = useChatStore()
  const projects = useProjectsStore()

  const tabs = ref<SessionTab[]>(restore())
  const activeKey = ref<string | null>(null)
  /** Sesiones que terminaron mientras su pestaña no estaba activa. */
  const unseen = ref(new Set<string>())
  /** La siguiente navegación a una sesión abre pestaña nueva (clic central, menú). */
  let forceNew = false

  const active = computed(() => tabs.value.find((tab) => tab.key === activeKey.value) ?? null)

  function save(): void {
    try {
      const keep = tabs.value
        .filter((tab) => tab.sessionId)
        .map(({ sessionId, title, projectId }) => ({ sessionId, title, projectId }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keep))
    } catch {
      // Sin almacenamiento: las pestañas no se recuerdan.
    }
  }
  watch(tabs, save, { deep: true })

  function statusOf(tab: SessionTab): Status {
    if (!tab.sessionId) return null
    const status = chat.statusOf(tab.sessionId)
    if (status === 'working' || status === 'starting') return 'working'
    if (status === 'waiting') return 'waiting'
    return unseen.value.has(tab.sessionId) ? 'done' : null
  }

  /** Se puede reutilizar para otra sesión: vacía, o sin trabajo ni avisos pendientes. */
  function replaceable(tab: SessionTab): boolean {
    return tab.sessionId === null || statusOf(tab) === null
  }

  /** Título y proyecto de la sesión, del índice (puede ser de otro proyecto que el activo). */
  async function describe(tab: SessionTab): Promise<void> {
    const sessionId = tab.sessionId
    if (!sessionId) return
    const result = await window.api.sessions.get(sessionId)
    const current = tabs.value.find((t) => t.key === tab.key)
    if (!result.ok || !result.data || !current || current.sessionId !== sessionId) return
    current.title = result.data.title
    const cwd = result.data.cwd
    current.projectId = cwd
      ? (projects.projects.find((p) => pathKey(p.path) === pathKey(cwd))?.id ?? null)
      : null
  }

  function refreshTitles(): void {
    for (const tab of tabs.value) void describe(tab)
  }

  function trim(): void {
    while (tabs.value.length > MAX_TABS) {
      const victim = tabs.value.find((tab) => tab.key !== activeKey.value && replaceable(tab))
      if (!victim) return
      tabs.value = tabs.value.filter((tab) => tab !== victim)
    }
  }

  function activate(tab: SessionTab): void {
    activeKey.value = tab.key
    if (tab.sessionId && unseen.value.has(tab.sessionId)) {
      const next = new Set(unseen.value)
      next.delete(tab.sessionId)
      unseen.value = next
    }
    // Pestaña de otro proyecto: la barra lateral pasa a ese proyecto.
    if (tab.projectId && tab.projectId !== projects.activeId) void projects.select(tab.projectId)
  }

  function insertAfterActive(tab: SessionTab): void {
    const index = tabs.value.findIndex((t) => t.key === activeKey.value)
    const list = [...tabs.value]
    list.splice(index === -1 ? list.length : index + 1, 0, tab)
    tabs.value = list
  }

  /** Decide la pestaña de la ruta actual (lo llama `App.vue` en cada navegación). */
  function syncRoute(route: RouteLocationNormalizedLoaded): void {
    if (route.name === 'home') {
      forceNew = false
      const empty = tabs.value.find((tab) => tab.sessionId === null)
      if (empty) return activate(empty)
      const tab: SessionTab = { key: newKey(), sessionId: null, title: '', projectId: null }
      insertAfterActive(tab)
      activate(tab)
      return trim()
    }
    if (route.name !== 'session') {
      activeKey.value = null
      return
    }
    const sessionId = String(route.params['id'] ?? '')
    if (!sessionId) return
    const wantsNew = forceNew
    forceNew = false
    const existing = tabs.value.find((tab) => tab.sessionId === sessionId)
    if (existing) return activate(existing)
    const current = active.value
    // La sesión nueva recién creada en la pestaña vacía se queda en ella.
    if (current && (current.sessionId === null || (!wantsNew && replaceable(current)))) {
      current.sessionId = sessionId
      current.title = t('Sesión')
      current.projectId = projects.activeId
      activate(current)
      void describe(current)
      return
    }
    const tab: SessionTab = {
      key: newKey(),
      sessionId,
      title: t('Sesión'),
      projectId: projects.activeId
    }
    insertAfterActive(tab)
    activate(tab)
    void describe(tab)
    trim()
  }

  function routeOf(tab: SessionTab): string {
    return tab.sessionId ? `/sesion/${tab.sessionId}` : '/'
  }

  function select(tab: SessionTab): void {
    void router.push(routeOf(tab))
  }

  /** Abre una sesión en una pestaña nueva (o va a la suya si ya la tiene). */
  function openInNewTab(sessionId: string): void {
    forceNew = true
    void router.push(`/sesion/${sessionId}`)
  }

  function close(tab: SessionTab): void {
    const index = tabs.value.findIndex((t) => t.key === tab.key)
    if (index === -1) return
    tabs.value = tabs.value.filter((t) => t.key !== tab.key)
    if (tab.key !== activeKey.value) return
    activeKey.value = null
    const next = tabs.value[index] ?? tabs.value[index - 1]
    void router.push(next ? routeOf(next) : '/')
  }

  function closeActive(): void {
    if (active.value) close(active.value)
  }

  /** `Ctrl+Tab` / `Ctrl+Mayús+Tab`. */
  function cycle(step: 1 | -1): void {
    if (tabs.value.length === 0) return
    const index = tabs.value.findIndex((t) => t.key === activeKey.value)
    const next = tabs.value[(index + step + tabs.value.length) % tabs.value.length]
    if (next) select(next)
  }

  // Renombrar en la lista cambia también el título de su pestaña.
  const sessions = useSessionsStore()
  watch(
    () => sessions.items,
    (items) => {
      for (const tab of tabs.value) {
        const item = tab.sessionId ? items.find((i) => i.sessionId === tab.sessionId) : null
        if (item && item.title !== tab.title) tab.title = item.title
      }
    }
  )

  // Terminó mientras no se miraba: marca de «terminado» hasta que se active su pestaña.
  watch(
    () => tabs.value.map((tab) => [tab.key, tab.sessionId, statusOf(tab) === 'working'] as const),
    (now, before) => {
      const was = new Map(before?.map(([key, id, working]) => [`${key}:${id}`, working]))
      for (const [key, sessionId, working] of now) {
        if (!sessionId || working || !was.get(`${key}:${sessionId}`)) continue
        if (key === activeKey.value) continue
        unseen.value = new Set([...unseen.value, sessionId])
      }
    }
  )

  return {
    tabs,
    activeKey,
    active,
    statusOf,
    syncRoute,
    select,
    openInNewTab,
    close,
    closeActive,
    cycle,
    refreshTitles
  }
})
