import type Database from 'better-sqlite3'
import type { AppStore } from '../services/app-store'
import { logger } from '../services/logger'
import { search } from '../services/search-query'
import { handle, IpcError } from './handle'

/** Búsqueda global: lectura con el lector `readonly` del main. */
export function registerSearchIpc(
  reader: Database.Database | null,
  store: AppStore,
  progress: () => { done: number; total: number } | null
): void {
  handle('search:query', (query) => {
    if (!reader) throw new IpcError('INTERNAL', 'El índice no está disponible')
    const state = store.get()
    try {
      return search(
        reader,
        {
          projects: state.projects,
          sessionMeta: state.sessionMeta,
          progress: progress(),
          log: logger
        },
        query
      )
    } catch (error) {
      logger.error('search', error)
      throw new IpcError('INTERNAL', 'No se pudo buscar')
    }
  })
}
