import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { DiscoveredProject, ProjectView } from '../../../shared/projects'

/**
 * Proyectos importados y el activo. La verdad está en el main
 * (`state.json`); el store guarda la última lista y el último error de una acción.
 */
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectView[]>([])
  const activeId = ref<string | null>(null)
  const loaded = ref(false)
  /** Mensaje del último error de importar/quitar/seleccionar (se muestra en el selector). */
  const error = ref<string | null>(null)

  const active = computed(() => projects.value.find((p) => p.id === activeId.value) ?? null)

  async function load(): Promise<void> {
    const [list, current] = await Promise.all([
      window.api.projects.list(),
      window.api.projects.active()
    ])
    if (list.ok) projects.value = list.data
    else console.error('No se pudieron leer los proyectos:', list.error.message)
    if (current.ok) activeId.value = current.data
    loaded.value = true
  }

  async function importPath(path: string): Promise<boolean> {
    const result = await window.api.projects.import(path)
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    error.value = null
    await load()
    return true
  }

  /** Diálogo nativo → importar. `false` si se cancela o falla. */
  async function importFolder(): Promise<boolean> {
    const picked = await window.api.system.pickFolder()
    if (!picked.ok) {
      error.value = picked.error.message
      return false
    }
    if (!picked.data) return false
    return importPath(picked.data)
  }

  async function importMany(paths: string[]): Promise<boolean> {
    const result = await window.api.projects.importMany(paths)
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    error.value = null
    await load()
    return true
  }

  async function remove(id: string): Promise<void> {
    const result = await window.api.projects.remove(id)
    if (!result.ok) error.value = result.error.message
    await load()
  }

  async function select(id: string): Promise<void> {
    if (id === activeId.value) return
    const result = await window.api.projects.select(id)
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    error.value = null
    activeId.value = id
    await load()
  }

  async function discover(): Promise<DiscoveredProject[] | null> {
    const result = await window.api.projects.discover()
    if (result.ok) return result.data
    error.value = result.error.message
    return null
  }

  function clearError(): void {
    error.value = null
  }

  return {
    projects,
    activeId,
    active,
    loaded,
    error,
    load,
    importPath,
    importFolder,
    importMany,
    remove,
    select,
    discover,
    clearError
  }
})
