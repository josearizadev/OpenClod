import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { FileTarget } from '../../../shared/files'
import type { GitInfo } from '../../../shared/git'
import { router } from '../router'
import { useProjectsStore } from './projects'

const MIN_GAP_MS = 2000

/**
 * Estado de Git de lo que se está viendo: la carpeta de la sesión abierta o,
 * fuera de una sesión, la del proyecto activo. Se refresca como mucho cada 2 s.
 */
export const useGitStore = defineStore('git', () => {
  const projects = useProjectsStore()

  const target = computed<FileTarget | null>(() => {
    const route = router.currentRoute.value
    if (route.name === 'session' && route.params['id']) {
      return { sessionId: String(route.params['id']) }
    }
    return projects.activeId ? { projectId: projects.activeId } : null
  })
  const targetKey = computed(() => JSON.stringify(target.value))

  const info = ref<GitInfo | null>(null)
  const loading = ref(false)
  /** Sube con cada consulta: el panel de archivos recarga el archivo abierto. */
  const tick = ref(0)

  let seq = 0
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function run(fresh: boolean): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    last = Date.now()
    const current = target.value
    const mine = ++seq
    if (!current) {
      info.value = null
      return
    }
    loading.value = true
    const result = await window.api.git.info({ target: current, fresh })
    if (mine !== seq) return
    loading.value = false
    info.value = result.ok ? result.data : null
    tick.value++
  }

  /** Algo pudo cambiar en disco (foco, pasada del índice, fin de turno). */
  function refresh(): void {
    const wait = MIN_GAP_MS - (Date.now() - last)
    if (wait <= 0) void run(true)
    else timer ??= setTimeout(() => void run(true), wait)
  }

  watch(
    targetKey,
    () => {
      info.value = null
      void run(false)
    },
    { immediate: true }
  )

  return { target, info, loading, tick, refresh, reload: () => run(true) }
})
