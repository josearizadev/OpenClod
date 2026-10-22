import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { SearchAuthor, SearchResult, SearchSort } from '../../../shared/search'
import { useProjectsStore } from './projects'
import { useSessionsStore } from './sessions'
import { useUiStore } from './ui'

/**
 * Búsqueda global. Consulta, filtros y resultados viven en memoria durante
 * la ejecución; el ámbito se guarda en los ajustes. Cada tecla espera 150 ms y lleva un
 * número de petición: una respuesta vieja no pisa la nueva.
 */
export const useSearchStore = defineStore('search', () => {
  const ui = useUiStore()
  const projects = useProjectsStore()
  const sessions = useSessionsStore()

  const open = ref(false)
  const text = ref('')
  const author = ref<SearchAuthor>('all')
  const sort = ref<SearchSort>('relevance')
  const results = shallowRef<SearchResult | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  /** Índice de la opción activa en la lista plana de fragmentos. */
  const selected = ref(0)

  /** Sin proyecto activo se busca en todos. */
  const scope = computed(() => (projects.activeId ? ui.searchScope : 'all'))

  let ticket = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Momento de la tecla que lanzó la búsqueda en curso. */
  let typedAt = 0

  async function run(): Promise<void> {
    const mine = ++ticket
    const query = text.value.trim()
    if (!query) {
      results.value = null
      error.value = null
      loading.value = false
      return
    }
    loading.value = true
    const result = await window.api.search.query({
      text: query.slice(0, 500),
      scope: scope.value,
      ...(scope.value === 'project' && projects.activeId ? { projectId: projects.activeId } : {}),
      author: author.value,
      sort: sort.value,
      includeHidden: sessions.showHidden,
      limit: 50
    })
    if (mine !== ticket) return
    loading.value = false
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    error.value = null
    results.value = result.data
    selected.value = 0
  }

  function schedule(delay = 150): void {
    if (timer) clearTimeout(timer)
    typedAt = performance.now()
    timer = setTimeout(() => {
      timer = null
      void run()
    }, delay)
  }

  watch(text, () => schedule())
  watch([author, sort, scope], () => schedule(0))

  function setScope(next: 'project' | 'all'): void {
    if (next === ui.searchScope) return
    void ui.setSearchScope(next)
  }

  function toggleScope(): void {
    if (!projects.activeId) return
    setScope(ui.searchScope === 'project' ? 'all' : 'project')
  }

  /** Lo llama el diálogo tras pintar unos resultados nuevos. */
  function painted(): void {
    if (!typedAt) return
    performance.mark('bitacora:busqueda-pintada', {
      detail: { ms: Math.round(performance.now() - typedAt) }
    })
    typedAt = 0
  }

  return {
    open,
    text,
    author,
    sort,
    scope,
    results,
    error,
    loading,
    selected,
    setScope,
    toggleScope,
    run,
    painted
  }
})
