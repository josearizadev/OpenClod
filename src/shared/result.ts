/**
 * Respuesta de toda llamada IPC. El renderer nunca recibe excepciones:
 * Electron pierde el tipo y el mensaje al serializarlas.
 */
export type ErrorCode = 'FORBIDDEN' | 'INVALID_ARGS' | 'INVALID_CWD' | 'NOT_FOUND' | 'INTERNAL'

export interface AppError {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}
