import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Log a archivo con rotación simple: `main.log`, `main.log.1`, … `main.log.N-1`.
 * Nunca registra prompts completos ni variables de entorno: solo ámbito, tipo de error y datos
 * mínimos. Escribir en el log nunca lanza excepciones.
 */
export type LogLevel = 'info' | 'warn' | 'error'

export interface LoggerOptions {
  maxBytes?: number
  maxFiles?: number
  /** Copia cada línea en la consola (útil en desarrollo). */
  echo?: boolean
}

export interface Logger {
  readonly file: string | null
  info(scope: string, message: string): void
  warn(scope: string, message: string): void
  error(scope: string, error: unknown): void
}

const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES = 3

export function describeError(error: unknown): string {
  if (error instanceof Error)
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
  return typeof error === 'string' ? error : `Valor lanzado no Error (${typeof error})`
}

export function createLogger(dir: string, options: LoggerOptions = {}): Logger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES)
  const file = join(dir, 'main.log')
  let ready = false

  function rotate(): void {
    rmSync(`${file}.${maxFiles - 1}`, { force: true })
    for (let i = maxFiles - 2; i >= 1; i--) {
      try {
        renameSync(`${file}.${i}`, `${file}.${i + 1}`)
      } catch {
        // Ese nivel aún no existe.
      }
    }
    if (maxFiles > 1) renameSync(file, `${file}.1`)
    else rmSync(file, { force: true })
  }

  function write(level: LogLevel, scope: string, message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}\n`
    if (options.echo) (level === 'error' ? console.error : console.log)(line.trimEnd())
    try {
      if (!ready) {
        mkdirSync(dir, { recursive: true })
        ready = true
      }
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        // El archivo aún no existe.
      }
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) rotate()
      appendFileSync(file, line, 'utf8')
    } catch {
      // Un fallo del log no debe tumbar la app.
    }
  }

  return {
    file,
    info: (scope, message) => write('info', scope, message),
    warn: (scope, message) => write('warn', scope, message),
    error: (scope, error) => write('error', scope, describeError(error))
  }
}

const consoleLogger: Logger = {
  file: null,
  info: (scope, message) => console.log(`[${scope}] ${message}`),
  warn: (scope, message) => console.warn(`[${scope}] ${message}`),
  error: (scope, error) => console.error(`[${scope}] ${describeError(error)}`)
}

let current: Logger = consoleLogger

/** Logger global del main. Hasta llamar a `initLogger` escribe solo en consola. */
export const logger: Logger = {
  get file() {
    return current.file
  },
  info: (scope, message) => current.info(scope, message),
  warn: (scope, message) => current.warn(scope, message),
  error: (scope, error) => current.error(scope, error)
}

export function initLogger(dir: string, options?: LoggerOptions): void {
  current = createLogger(dir, options)
}
