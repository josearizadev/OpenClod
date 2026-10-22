import type { TerminalShells } from '../../shared/terminal'
import { FileAccessError } from '../services/file-access'
import { TerminalError, type TerminalService } from '../services/terminal'
import { handle, IpcError } from './handle'

async function guarded<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof TerminalError) throw new IpcError('INVALID_ARGS', error.message)
    if (error instanceof FileAccessError) throw new IpcError(error.code, error.message)
    throw error
  }
}

/**
 * Canales de la terminal. La dueña de cada terminal es la ventana que la
 * abre o la vuelve a pedir con `attach`. `service` es `null` si node-pty no cargó.
 */
export function registerTerminalIpc(
  service: TerminalService | null,
  shells: () => Promise<TerminalShells>
): void {
  const need = (): TerminalService => {
    if (!service) throw new IpcError('INTERNAL', 'La terminal no está disponible')
    return service
  }
  handle('terminal:shells', () => shells())
  handle('terminal:open', (input, event) => guarded(() => need().open(event.sender.id, input)))
  handle('terminal:list', () => service?.list() ?? [])
  handle('terminal:attach', ({ id }, event) => guarded(() => need().attach(event.sender.id, id)))
  handle('terminal:write', ({ id, data }) => guarded(() => need().write(id, data)))
  handle('terminal:resize', ({ id, cols, rows }) => guarded(() => need().resize(id, cols, rows)))
  handle('terminal:restart', ({ id }) => guarded(() => need().restart(id)))
  handle('terminal:close', ({ id }) => guarded(() => need().close(id)))
}
