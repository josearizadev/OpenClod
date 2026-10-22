import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { TranscriptAppend, TranscriptItem, TranscriptPayload } from '../../../shared/sessions'

/**
 * Transcript de la sesión abierta. Se lee del main en cada apertura (el
 * índice no guarda contenido) y vive solo en memoria mientras la vista está abierta
 *. Las respuestas de una sesión anterior se descartan. Mientras está abierta, el main
 * manda lo nuevo de disco (`sessions:appended`) y se añade sin releer.
 */
export const useTranscriptStore = defineStore('transcript', () => {
  /** `shallowRef`: miles de elementos que no cambian; nada de reactividad profunda. */
  const payload = shallowRef<TranscriptPayload | null>(null)
  const sessionId = ref<string | null>(null)
  const state = ref<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle')
  const error = ref<string | null>(null)
  /** Entrada de la lista a la que sigue la conversación. */
  const continuedIn = ref<string | null>(null)
  /** Hay una recarga en curso (sin vaciar lo que se ve). */
  const reloading = ref(false)

  /** Transcripts de subagentes ya pedidos (`sessionId/agentId`; `null` = no encontrado). */
  const subagentCache = new Map<string, TranscriptItem[] | null>()
  /** Sube cuando `append` añade a la caché de subagentes (la caché no es reactiva). */
  const subagentTick = ref(0)

  let ticket = 0

  async function fetch(id: string, keep: boolean): Promise<void> {
    const mine = ++ticket
    if (keep) reloading.value = true
    else {
      state.value = 'loading'
      payload.value = null
    }
    performance.mark('bitacora:transcript-pedido')
    const result = await window.api.sessions.transcript(id)
    if (mine !== ticket) return
    performance.mark('bitacora:transcript-recibido')
    reloading.value = false
    if (!result.ok) {
      state.value = 'error'
      error.value = result.error.message
      return
    }
    error.value = null
    subagentCache.clear()
    if (!result.data) {
      state.value = 'missing'
      payload.value = null
      return
    }
    payload.value = result.data
    state.value = 'ready'
  }

  function open(id: string): Promise<void> {
    sessionId.value = id
    continuedIn.value = null
    return fetch(id, false)
  }

  /** Vuelve a leer la sesión abierta sin pasar por el estado de carga. */
  function reload(): Promise<void> {
    if (!sessionId.value) return Promise.resolve()
    return fetch(sessionId.value, state.value === 'ready')
  }

  function close(): void {
    ticket++
    sessionId.value = null
    payload.value = null
    state.value = 'idle'
    continuedIn.value = null
  }

  /**
   * Lo nuevo de disco. Devuelve `true` si añadió elementos. Con `reset`
   * relee anclado.
   */
  function append(event: TranscriptAppend): boolean {
    if (event.sessionId !== sessionId.value) return false
    if (event.reset) {
      void reload()
      return false
    }
    if (event.continuedIn) continuedIn.value = event.continuedIn
    for (const [agentId, items] of Object.entries(event.subagentItems ?? {})) {
      const key = `${event.sessionId}/${agentId}`
      const cached = subagentCache.get(key)
      if (cached) {
        subagentCache.set(key, [...cached, ...items])
        subagentTick.value++
      }
    }
    const p = payload.value
    if (!p || state.value !== 'ready') return false
    if (event.items.length === 0 && !event.subagents) return false
    payload.value = {
      ...p,
      items: event.items.length ? [...p.items, ...event.items] : p.items,
      ...(event.subagents ? { subagents: event.subagents } : {}),
      ...(event.updatedAt ? { updatedAt: event.updatedAt } : {})
    }
    return event.items.length > 0
  }

  return {
    payload,
    sessionId,
    state,
    error,
    continuedIn,
    reloading,
    subagentCache,
    subagentTick,
    open,
    reload,
    close,
    append
  }
})
