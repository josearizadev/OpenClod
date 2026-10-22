import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeInput,
  InvokeOutput
} from '../shared/ipc-contract'
import type { Result } from '../shared/result'

/** Llama a un canal del contrato. La validación ocurre en el main. */
export function invoke<C extends InvokeChannel>(
  channel: C,
  input: InvokeInput<C>
): Promise<Result<InvokeOutput<C>>> {
  return ipcRenderer.invoke(channel, input)
}

/** Se suscribe a un evento main → renderer; devuelve la función para desuscribirse. */
export function subscribe<C extends EventChannel>(
  channel: C,
  callback: (payload: EventPayload<C>) => void
): () => void {
  const listener = (_event: IpcRendererEvent, payload: EventPayload<C>): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
