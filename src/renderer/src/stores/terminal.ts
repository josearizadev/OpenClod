import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { FileTarget } from '../../../shared/files'
import type { TerminalInfo, TerminalKind, TerminalShells } from '../../../shared/terminal'
import { router } from '../router'
import { useChatStore } from './chat'
import { useProjectsStore } from './projects'
import { useUiStore } from './ui'
import { t } from '../i18n'

type DataListener = (data: string) => void

/**
 * Terminales de la vista Terminal. Los procesos y su salida viven en el main;
 * aquí, la lista, la pestaña activa y el reparto de `terminal:data` a cada panel.
 */
export const useTerminalStore = defineStore('terminal', () => {
  const ui = useUiStore()
  const projects = useProjectsStore()
  const chat = useChatStore()

  const terminals = ref<TerminalInfo[]>([])
  const activeId = ref<string | null>(null)
  const shells = ref<TerminalShells | null>(null)
  const error = ref<string | null>(null)
  const active = computed(() => terminals.value.find((t) => t.id === activeId.value) ?? null)

  const listeners = new Map<string, DataListener>()
  let subscribed = false

  function subscribe(): void {
    if (subscribed) return
    subscribed = true
    window.api.terminal.onData(({ id, data }) => listeners.get(id)?.(data))
    window.api.terminal.onExit(({ id, exitCode }) => {
      const index = terminals.value.findIndex((t) => t.id === id)
      if (index >= 0) {
        terminals.value[index] = { ...terminals.value[index]!, status: 'exited', exitCode }
      }
    })
  }

  /** El panel de una terminal recibe su salida; devuelve la función para dejar de escuchar. */
  function listen(id: string, listener: DataListener): () => void {
    listeners.set(id, listener)
    return () => {
      if (listeners.get(id) === listener) listeners.delete(id)
    }
  }

  async function load(): Promise<void> {
    subscribe()
    const [list, available] = await Promise.all([
      window.api.terminal.list(),
      window.api.terminal.shells()
    ])
    if (available.ok) shells.value = available.data
    if (list.ok) {
      terminals.value = list.data
      if (!terminals.value.some((t) => t.id === activeId.value)) {
        activeId.value = terminals.value.at(-1)?.id ?? null
      }
    }
  }

  async function open(kind: TerminalKind, target?: FileTarget): Promise<TerminalInfo | null> {
    subscribe()
    const fallback: FileTarget | undefined = projects.activeId
      ? { projectId: projects.activeId }
      : undefined
    const result = await window.api.terminal.open({
      kind,
      ...((target ?? fallback) ? { target: target ?? fallback } : {}),
      cols: 100,
      rows: 30
    })
    if (!result.ok) {
      error.value = result.error.message
      ui.toast(t('No se pudo abrir la terminal: {error}', { error: result.error.message }), {
        tone: 'danger'
      })
      return null
    }
    error.value = null
    terminals.value.push(result.data)
    activeId.value = result.data.id
    return result.data
  }

  async function restart(id: string): Promise<void> {
    const result = await window.api.terminal.restart(id)
    if (!result.ok) return ui.toast(result.error.message, { tone: 'danger' })
    const index = terminals.value.findIndex((t) => t.id === id)
    if (index >= 0) terminals.value[index] = result.data
  }

  async function close(id: string): Promise<void> {
    await window.api.terminal.close(id)
    const index = terminals.value.findIndex((t) => t.id === id)
    if (index < 0) return
    terminals.value.splice(index, 1)
    if (activeId.value === id) {
      activeId.value = terminals.value[Math.min(index, terminals.value.length - 1)]?.id ?? null
    }
  }

  // --- Continuar una sesión en la CLI ------------------------------------------------

  /** Sesión con chat de la app abierto que espera confirmación. */
  const confirmResume = ref<string | null>(null)

  async function resume(sessionId: string, confirmed = false): Promise<void> {
    const state = chat.stateOf(sessionId)
    if (!confirmed && state && state.status !== 'closed') {
      confirmResume.value = sessionId
      return
    }
    if (confirmResume.value === sessionId) confirmResume.value = null
    if (state && state.status !== 'closed') await chat.close(sessionId)
    const opened = await open('resume', { sessionId })
    if (opened) await router.push('/terminal')
  }

  /** `claude auth login` en la vista Terminal (Ajustes, error de sesión del chat). */
  async function login(): Promise<void> {
    const opened = await open('login')
    if (opened) await router.push('/terminal')
  }

  return {
    login,
    terminals,
    activeId,
    active,
    shells,
    error,
    load,
    open,
    restart,
    close,
    listen,
    confirmResume,
    resume
  }
})
