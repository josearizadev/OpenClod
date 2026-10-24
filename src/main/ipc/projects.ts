import { ProjectError, type ProjectsService } from '../services/projects'
import { TranscriptReadError, type TranscriptService } from '../services/transcript'
import type { TranscriptFollower } from '../services/transcript-follower'
import type { SessionTrashResult } from '../../shared/projects'
import { handle, IpcError } from './handle'
import { t } from '../i18n'

/** Traduce los rechazos previstos del servicio a errores IPC con su mensaje. */
async function guarded<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ProjectError) {
      throw new IpcError(
        error.code === 'INVALID_CWD' ? 'INVALID_CWD' : 'INVALID_ARGS',
        error.message
      )
    }
    if (error instanceof TranscriptReadError) throw new IpcError('INTERNAL', error.message)
    throw error
  }
}

/** Canales de proyectos y sesiones. */
export function registerProjectsIpc(
  service: ProjectsService,
  transcripts: TranscriptService,
  follower?: TranscriptFollower,
  trash?: (sessionIds: string[]) => Promise<SessionTrashResult>
): void {
  handle('projects:list', () => service.list())
  handle('projects:import', ({ path }) => guarded(() => service.import(path)))
  handle('projects:importMany', ({ paths }) => guarded(() => service.importMany(paths)))
  handle('projects:remove', ({ id }) => guarded(() => service.remove(id)))
  handle('projects:select', ({ id }) => guarded(() => service.select(id)))
  handle('projects:active', () => service.active())
  handle('projects:discover', () => service.discover())
  handle('sessions:list', ({ projectId }) => service.sessions(projectId))
  handle('sessions:get', ({ sessionId }) => service.session(sessionId))
  handle('sessions:update', (patch) => service.update(patch))
  handle('sessions:trash', ({ sessionIds }) => {
    if (!trash) throw new IpcError('INTERNAL', t('El índice no está disponible.'))
    return trash(sessionIds)
  })
  handle('sessions:metaStats', () => service.metaStats())
  // Leer una sesión para el visor la deja seguida por esa ventana.
  handle('sessions:transcript', ({ sessionId }, event) =>
    guarded(() => transcripts.transcript(sessionId, event.sender.id))
  )
  handle('sessions:follow', ({ sessionId }, event) => {
    if (sessionId === null) follower?.untrack(event.sender.id)
  })
  handle('sessions:subagent', ({ sessionId, agentId }) =>
    guarded(() => transcripts.subagent(sessionId, agentId))
  )
}
