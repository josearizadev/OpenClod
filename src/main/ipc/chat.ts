import { BrowserWindow } from 'electron'
import type { ChatCatalog, ChatEvent } from '../../shared/chat'
import { ChatServiceError, type ChatService } from '../services/chat/chat-service'
import { handle, IpcError } from './handle'

/** Envía un evento del chat a todas las ventanas de la app. */
export function emitChatEvent(event: ChatEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send('chat:event', event)
  }
}

/** Los rechazos previstos del servicio llegan al renderer con su código y su mensaje. */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ChatServiceError) throw new IpcError(error.code, error.message)
    throw error
  }
}

/** Canales del chat. zod valida cada entrada en `handle`. */
export function registerChatIpc(
  service: ChatService,
  opts: { catalog: () => ChatCatalog; onQuit: (restart: boolean) => void }
): void {
  handle('chat:start', (input) => guard(() => service.start(input)))
  handle('chat:send', (input) => guard(() => service.send(input)))
  handle('chat:queueEdit', ({ sessionId, uuid, text }) =>
    guard(() => service.queueEdit(sessionId, uuid, text))
  )
  handle('chat:queueRemove', ({ sessionId, uuid }) =>
    guard(() => service.queueRemove(sessionId, uuid))
  )
  handle('chat:queueSendNow', ({ sessionId, uuid }) =>
    guard(() => service.queueSendNow(sessionId, uuid))
  )
  handle('chat:interrupt', ({ sessionId }) => guard(() => service.interrupt(sessionId)))
  handle('chat:permission', (input) => guard(() => service.respond(input)))
  handle('chat:setModel', ({ sessionId, model }) => guard(() => service.setModel(sessionId, model)))
  handle('chat:setMode', ({ sessionId, mode }) => guard(() => service.setMode(sessionId, mode)))
  handle('chat:setChrome', ({ sessionId, enabled }) =>
    guard(() => service.setChrome(sessionId, enabled))
  )
  handle('chat:stopTask', ({ sessionId, taskId }) =>
    guard(() => service.stopTask(sessionId, taskId))
  )
  handle('chat:close', ({ sessionId }) => guard(() => service.close(sessionId)))
  handle('chat:reconciled', ({ sessionId, uuids }) => service.reconcile(sessionId, uuids))
  handle('chat:snapshot', ({ sessionId }) => service.snapshot(sessionId))
  handle('chat:active', () => service.active())
  handle('chat:catalog', () => opts.catalog())
  handle('app:quit', (input) => opts.onQuit(input?.restart ?? false))
}
