import type { IndexStatus } from '../../shared/projects'
import type { IndexService } from '../services/index-service'
import { logger } from '../services/logger'
import { IpcError, handle } from './handle'

/**
 * Canales del índice. Si el índice no se pudo abrir no hay servicio:
 * `index:status` explica el error y `refresh`/`rebuild` fallan con `INTERNAL`.
 */
export function registerIndexIpc(
  service: IndexService | null,
  status: () => IndexStatus,
  onRefresh?: () => void
): void {
  handle('index:status', () => status())
  handle('index:refresh', () => {
    onRefresh?.()
    return run(service, 'refresh')
  })
  handle('index:rebuild', () => run(service, 'rebuild'))
}

async function run(service: IndexService | null, kind: 'refresh' | 'rebuild'): Promise<void> {
  if (!service) throw new IpcError('INTERNAL', 'El índice no está disponible')
  try {
    await service[kind]()
  } catch (error) {
    logger.error('index', error)
    throw new IpcError('INTERNAL', 'No se pudo actualizar el índice')
  }
}
