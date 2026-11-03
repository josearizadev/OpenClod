import type { ComposedContext } from '../../shared/context'
import { ContextError, type ProjectContextService } from '../services/project-context'
import { handle, IpcError } from './handle'
import { t } from '../i18n'

/** Traduce los rechazos previstos del servicio a errores IPC con su mensaje. */
async function guarded<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ContextError) {
      throw new IpcError(error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_ARGS', error.message)
    }
    throw error
  }
}

export interface ContextIpcDeps {
  service: ProjectContextService
  /** El proyecto existe (las rutas siempre salen del `projectId`). */
  projectExists: (projectId: string) => boolean
  openPath: (path: string) => Promise<string>
  /** Contexto de una sesión nueva en `cwd` (y carpeta de sesiones). */
  preview: (cwd: string, folderId: string | undefined) => Promise<ComposedContext>
}

/** Canales del contexto del proyecto y de la vista previa de la bienvenida. */
export function registerContextIpc(deps: ContextIpcDeps): void {
  const { service } = deps
  const check = (projectId: string): void => {
    if (!deps.projectExists(projectId)) throw new IpcError('NOT_FOUND', t('El proyecto no existe.'))
  }
  handle('context:list', ({ projectId }) => {
    check(projectId)
    return guarded(() => service.list(projectId))
  })
  handle('context:read', ({ projectId, name }) => {
    check(projectId)
    return guarded(() => service.read(projectId, name))
  })
  handle('context:write', ({ projectId, name, text, expectedHash }) => {
    check(projectId)
    return guarded(() => service.write(projectId, name, text, expectedHash))
  })
  handle('context:rename', ({ projectId, from, to }) => {
    check(projectId)
    return guarded(() => service.rename(projectId, from, to))
  })
  handle('context:remove', ({ projectId, name }) => {
    check(projectId)
    return guarded(() => service.remove(projectId, name))
  })
  handle('context:setEnabled', ({ projectId, name, enabled }) => {
    check(projectId)
    return guarded(() => service.setEnabled(projectId, name, enabled))
  })
  handle('context:openFolder', async ({ projectId }) => {
    check(projectId)
    const error = await deps.openPath(await service.ensureDir(projectId))
    if (error) throw new IpcError('INTERNAL', error)
  })
  handle('context:preview', ({ cwd, folderId }) => deps.preview(cwd, folderId))
}
