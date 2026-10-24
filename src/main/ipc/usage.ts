import type Database from 'better-sqlite3'
import type { AppStore } from '../services/app-store'
import type { LimitsService } from '../services/limits'
import { logger } from '../services/logger'
import { conversationCost, usageReport } from '../services/usage-report'
import { handle, IpcError } from './handle'
import { t } from '../i18n'

/** Uso y límites: informe con el lector `readonly` y estado de los límites. */
export function registerUsageIpc(
  reader: Database.Database | null,
  store: AppStore,
  limits: LimitsService
): void {
  handle('usage:report', (query) => {
    if (!reader) throw new IpcError('INTERNAL', t('El índice no está disponible'))
    const state = store.get()
    try {
      return usageReport(reader, query, {
        projects: state.projects,
        sessionMeta: state.sessionMeta,
        showCost: state.usage.showCost
      })
    } catch (error) {
      logger.error('usage', error)
      throw new IpcError('INTERNAL', t('No se pudo calcular el uso'))
    }
  })
  handle('usage:limits', () => limits.snapshot())
  handle('usage:sessionCost', (sessionId) => {
    if (!reader || !store.get().usage.showCost) return null
    try {
      return conversationCost(reader, sessionId)
    } catch (error) {
      logger.error('usage', error)
      return null
    }
  })
  handle('usage:probe', async ({ force }) => {
    await limits.requestUsage({ allowProbe: true, force })
    return limits.snapshot()
  })
}
