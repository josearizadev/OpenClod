import type { AppStore } from '../services/app-store'
import { FileAccessError, resolveRoot, type RootDeps } from '../services/file-access'
import { logger } from '../services/logger'
import {
  ProjectSettingsError,
  readProjectSettings,
  writeProjectSettings
} from '../services/project-settings'
import { handle, IpcError } from './handle'
import { t } from '../i18n'

/** Traduce los rechazos previstos a errores IPC con su mensaje. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof FileAccessError) throw new IpcError(error.code, error.message)
    if (error instanceof ProjectSettingsError) throw new IpcError('INVALID_ARGS', error.message)
    throw error
  }
}

/** Canales de los ajustes del proyecto. */
export function registerProjectSettingsIpc(deps: RootDeps & { store: AppStore }): void {
  const chromeOf = (projectId: string): boolean =>
    deps.store.get().projectPrefs[projectId]?.chrome ?? false

  handle('projectSettings:read', ({ projectId }) =>
    guarded(async () =>
      readProjectSettings(
        await resolveRoot({ projectId }, deps),
        deps.claudeDir(),
        chromeOf(projectId)
      )
    )
  )

  handle('projectSettings:write', ({ projectId, expectedHash, ...patch }) =>
    guarded(async () => {
      const result = await writeProjectSettings(
        await resolveRoot({ projectId }, deps),
        deps.claudeDir(),
        patch,
        expectedHash,
        chromeOf(projectId)
      )
      if (result.ok) logger.info('project-settings', 'Ajustes del proyecto guardados')
      return result
    })
  )

  handle('projectSettings:setChrome', ({ projectId, enabled }) => {
    const state = deps.store.get()
    if (!state.projects.some((p) => p.id === projectId))
      throw new IpcError('NOT_FOUND', t('El proyecto ya no existe'))
    const prefs = { ...state.projectPrefs }
    if (enabled) prefs[projectId] = { chrome: true }
    else delete prefs[projectId]
    deps.store.set({ projectPrefs: prefs })
  })
}
