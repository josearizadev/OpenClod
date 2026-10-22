import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  invokeContract,
  type InvokeChannel,
  type InvokeInput,
  type InvokeOutput
} from '../../shared/ipc-contract'
import { err, ok, type ErrorCode, type Result } from '../../shared/result'
import { logger } from '../services/logger'
import { isAppUrl } from '../window'

// Mensajes de validación en español (la UI es en español).
z.config(z.locales.es())

/**
 * Rechazo previsto de un handler (p. ej. una carpeta que no existe). Su código y su mensaje
 * llegan tal cual al renderer; cualquier otra excepción se convierte en `INTERNAL`.
 */
export class IpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

export type Handler<C extends InvokeChannel> = (
  input: InvokeInput<C>,
  event: IpcMainInvokeEvent
) => InvokeOutput<C> | Promise<InvokeOutput<C>>

/** Solo se aceptan llamadas de la página de la app (nunca de otro frame u origen). */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  return typeof url === 'string' && isAppUrl(url)
}

/**
 * Registra un canal del contrato: comprueba el remitente, valida la entrada con zod
 * y devuelve siempre un `Result`, sin propagar excepciones.
 */
export function handle<C extends InvokeChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<InvokeOutput<C>>> => {
    if (!isTrustedSender(event)) {
      logger.warn('ipc', `${channel}: remitente no permitido`)
      return err('FORBIDDEN', 'Origen no permitido')
    }
    const parsed = invokeContract[channel].input.safeParse(raw)
    if (!parsed.success) return err('INVALID_ARGS', z.prettifyError(parsed.error))
    try {
      return ok(await fn(parsed.data as InvokeInput<C>, event))
    } catch (error) {
      if (error instanceof IpcError) return err(error.code, error.message)
      logger.error(`ipc ${channel}`, error)
      return err('INTERNAL', 'Error interno')
    }
  })
}
