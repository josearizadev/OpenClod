import type { SearchScope } from '../../../shared/search'
import type { Language } from '../../../shared/i18n'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_TERMINAL,
  DEFAULT_VIEWER,
  type ChatSettings,
  type NotificationSettings,
  type TerminalSettings,
  type WindowSettings,
  type Theme,
  type Viewer
} from '../../../shared/types'

/** Aviso breve abajo a la derecha (`AppToast`). */
export interface Toast {
  id: number
  text: string
  tone?: 'danger'
  action?: { label: string; run: () => void }
}

const SIDEBAR_KEY = 'bitacora.sidebarCollapsed'

// localStorage puede fallar (almacenamiento bloqueado): la preferencia es solo una comodidad.
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed))
  } catch {
    // Sin persistencia: la barra vuelve a su estado por defecto al reiniciar.
  }
}

/**
 * Estado de la interfaz. La preferencia de tema vive en el main (`state.json`) y
 * se aplica con `nativeTheme.themeSource`; el renderer solo observa `prefers-color-scheme`,
 * que ya refleja esa elección, y pone o quita `.dark` en `<html>`.
 * El estado plegado de la barra lateral se guarda en `localStorage`.
 */
export const useUiStore = defineStore('ui', () => {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const theme = ref<Theme>('system')
  const isDark = ref(media.matches)

  media.addEventListener('change', (event) => {
    isDark.value = event.matches
  })
  // `immediate`: la clase se pone al crear el store, antes de montar la app.
  watch(isDark, (dark) => document.documentElement.classList.toggle('dark', dark), {
    immediate: true
  })

  /** Idioma elegido (`system` = el del sistema) y bienvenida ya vista. */
  const language = ref<Language>('system')
  const welcomed = ref(true)
  /** Los ajustes ya se leyeron: hasta entonces no se sabe si toca la bienvenida. */
  const settingsLoaded = ref(false)

  async function loadSettings(): Promise<void> {
    const result = await window.api.settings.get()
    settingsLoaded.value = true
    if (result.ok) {
      language.value = result.data.language
      welcomed.value = result.data.welcomed
      theme.value = result.data.theme
      viewer.value = result.data.viewer
      chat.value = result.data.chat
      searchScope.value = result.data.search.scope
      notifications.value = result.data.notifications
      terminal.value = result.data.terminal
      windowSettings.value = result.data.window
    } else console.error('No se pudieron leer los ajustes:', result.error.message)
  }

  /** Filtros del visor: preferencia de la app, guardada en `state.json`. */
  const viewer = ref<Viewer>({ ...DEFAULT_VIEWER })

  async function setViewer(patch: Partial<Viewer>): Promise<void> {
    const previous = viewer.value
    const next: Viewer = { ...previous, ...patch }
    viewer.value = next
    // Objeto plano: un proxy reactivo no se puede clonar por IPC.
    const result = await window.api.settings.set({
      viewer: { tools: next.tools, thinking: next.thinking, internal: next.internal }
    })
    if (!result.ok) {
      viewer.value = previous
      console.error('No se pudieron guardar los filtros:', result.error.message)
    }
  }

  /** Preferencias del chat: valores para las sesiones nuevas. */
  const chat = ref<ChatSettings>({ ...DEFAULT_CHAT_SETTINGS })

  async function setChat(patch: Partial<ChatSettings>): Promise<void> {
    const previous = chat.value
    const next: ChatSettings = { ...previous, ...patch }
    chat.value = next
    const result = await window.api.settings.set({
      chat: { model: next.model, permissionMode: next.permissionMode, filesPanel: next.filesPanel }
    })
    if (!result.ok) {
      chat.value = previous
      console.error('No se pudieron guardar las preferencias del chat:', result.error.message)
    }
  }

  async function setTheme(next: Theme): Promise<void> {
    const previous = theme.value
    theme.value = next
    const result = await window.api.settings.set({ theme: next })
    if (result.ok) theme.value = result.data.theme
    else {
      theme.value = previous
      console.error('No se pudo guardar el tema:', result.error.message)
    }
  }

  /** Ámbito de la búsqueda global: se recuerda entre ejecuciones. */
  const searchScope = ref<SearchScope>('project')
  async function setSearchScope(next: SearchScope): Promise<void> {
    searchScope.value = next
    const result = await window.api.settings.set({ search: { scope: next } })
    if (!result.ok) console.error('No se pudo guardar el ámbito de búsqueda:', result.error.message)
  }

  /** Notificaciones del sistema. */
  const notifications = ref<NotificationSettings>({ ...DEFAULT_NOTIFICATIONS })
  async function setNotifications(patch: Partial<NotificationSettings>): Promise<void> {
    const previous = notifications.value
    notifications.value = { ...previous, ...patch }
    const result = await window.api.settings.set({ notifications: { ...notifications.value } })
    if (result.ok) notifications.value = result.data.notifications
    else {
      notifications.value = previous
      console.error('No se pudieron guardar las notificaciones:', result.error.message)
    }
  }

  /** Terminal de respaldo: shell, tamaño de letra y lector de pantalla. */
  const terminal = ref<TerminalSettings>({ ...DEFAULT_TERMINAL })
  async function setTerminal(patch: Partial<TerminalSettings>): Promise<void> {
    const previous = terminal.value
    terminal.value = { ...previous, ...patch }
    const result = await window.api.settings.set({ terminal: { ...terminal.value } })
    if (result.ok) terminal.value = result.data.terminal
    else {
      terminal.value = previous
      console.error('No se pudieron guardar los ajustes de la terminal:', result.error.message)
    }
  }

  /** Ventana: mantener en la bandeja al cerrar. */
  const windowSettings = ref<WindowSettings>({ closeToTray: false })
  async function setWindow(patch: Partial<WindowSettings>): Promise<void> {
    const previous = windowSettings.value
    windowSettings.value = { ...previous, ...patch }
    const result = await window.api.settings.set({ window: { ...windowSettings.value } })
    if (result.ok) windowSettings.value = result.data.window
    else {
      windowSettings.value = previous
      console.error('No se pudo guardar el ajuste de la ventana:', result.error.message)
    }
  }

  /**
   * Cambiar de idioma recarga la ventana: los textos se fijan al cargar. Los chats y las
   * terminales viven en el main y siguen como estaban.
   */
  async function setLanguage(next: Language): Promise<void> {
    if (next === language.value) return
    const result = await window.api.settings.set({ language: next })
    if (!result.ok) return console.error('No se pudo guardar el idioma:', result.error.message)
    language.value = next
    window.location.reload()
  }

  async function finishWelcome(): Promise<void> {
    welcomed.value = true
    const result = await window.api.settings.set({ welcomed: true })
    if (!result.ok) console.error('No se pudo guardar la bienvenida:', result.error.message)
  }

  /** Diálogo «Acerca de OpenClod». */
  const aboutOpen = ref(false)

  const toastState = ref<Toast | null>(null)
  let toastSeq = 0
  function toast(text: string, options: Omit<Toast, 'id' | 'text'> = {}): void {
    toastState.value = { id: ++toastSeq, text, ...options }
  }

  const sidebarCollapsed = ref(readSidebarCollapsed())
  watch(sidebarCollapsed, writeSidebarCollapsed)

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /** Título de la cabecera que fija la vista abierta (p. ej. la ficha de una sesión). */
  const pageTitle = ref<string | null>(null)
  /** Fantasma activado en «Nueva sesión»: la próxima sesión será de incógnito. */
  const incognitoNext = ref(false)

  return {
    theme,
    isDark,
    language,
    welcomed,
    settingsLoaded,
    setLanguage,
    finishWelcome,
    loadSettings,
    setTheme,
    viewer,
    setViewer,
    chat,
    setChat,
    searchScope,
    setSearchScope,
    notifications,
    setNotifications,
    terminal,
    setTerminal,
    windowSettings,
    setWindow,
    aboutOpen,
    toastState,
    toast,
    sidebarCollapsed,
    toggleSidebar,
    pageTitle,
    incognitoNext
  }
})
