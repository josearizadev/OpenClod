/**
 * Estado de la actualización de la app. Solo la versión instalada busca actualizaciones: en
 * desarrollo el estado es siempre `disabled`.
 */
export type UpdateStatus =
  | { state: 'disabled' }
  | { state: 'idle' }
  | { state: 'checking' }
  /** No hay versión nueva; `checkedAt` en ISO. */
  | { state: 'latest'; checkedAt: string }
  | { state: 'downloading'; version: string; percent: number }
  /** Descargada: se instala al reiniciar o al salir de la app. */
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
