import { defineStore } from 'pinia'
import { ref } from 'vue'
import { gitAbsolute } from '../lib/git'
import { useUiStore } from './ui'

/** Lista del panel de archivos. */
export type FilesList = 'session' | 'git'

/**
 * Archivo elegido en el panel derecho: `key` identifica la fila; `path` es lo que se pide al
 * main (absoluta o relativa a la carpeta de la sesión).
 */
export interface FileSelection {
  source: FilesList
  key: string
  path: string
}

/** Estado del panel de archivos: qué lista se ve y qué archivo está abierto. */
export const useFilesStore = defineStore('files', () => {
  const ui = useUiStore()
  const list = ref<FilesList>('session')
  const selected = ref<FileSelection | null>(null)

  function open(selection: FileSelection): void {
    list.value = selection.source
    selected.value = selection
    if (!ui.chat.filesPanel) void ui.setChat({ filesPanel: true })
  }

  /** Un cambio de Git (ruta relativa a la raíz del repositorio). */
  function openGit(root: string, path: string): void {
    open({ source: 'git', key: `git:${path}`, path: gitAbsolute(root, path) })
  }

  function reset(): void {
    selected.value = null
  }

  return { list, selected, open, openGit, reset }
})
