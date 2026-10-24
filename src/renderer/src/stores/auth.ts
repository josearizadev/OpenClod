import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AuthStatus } from '../../../shared/auth'

/**
 * Sesión de Claude Code (bienvenida y Ajustes). La consulta lanza `claude auth status`, que
 * tarda alrededor de un segundo: solo se pide al abrir esas vistas o al comprobar de nuevo.
 */
export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus | null>(null)
  const checking = ref(false)
  let pending: Promise<AuthStatus> | null = null

  function refresh(): Promise<AuthStatus> {
    pending ??= (async () => {
      checking.value = true
      try {
        const result = await window.api.auth.status()
        status.value = result.ok ? result.data : { state: 'unknown' }
        return status.value
      } finally {
        checking.value = false
        pending = null
      }
    })()
    return pending
  }

  return { status, checking, refresh }
})
