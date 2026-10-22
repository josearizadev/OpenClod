import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_STATE, StateSchema, type State } from '../../shared/types'
import { logger as defaultLogger, type Logger } from './logger'

/**
 * Estado de la app en `state.json`: ajustes y proyectos. Se lee una vez al crear el store, se
 * valida
 * con zod y, si el archivo falta o está corrupto, se usan los valores por defecto. Cada cambio
 * se escribe de forma atómica (archivo temporal + rename).
 */
export interface AppStore {
  readonly file: string
  get(): State
  /** Aplica `patch`, lo persiste y devuelve el estado resultante. Lanza si no puede escribir. */
  set(patch: Partial<State>): State
}

function defaults(): State {
  return structuredClone(DEFAULT_STATE)
}

function load(file: string, log: Pick<Logger, 'warn'>): State {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // Primer arranque: aún no hay archivo.
    return defaults()
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    log.warn('app-store', 'state.json no es JSON válido; se usan los valores por defecto')
    return defaults()
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    log.warn('app-store', 'state.json no es un objeto; se usan los valores por defecto')
    return defaults()
  }
  // Las claves que falten (p. ej. `projects` en un state.json de una versión antigua) toman su
  // valor
  // por defecto.
  const parsed = StateSchema.safeParse({ ...DEFAULT_STATE, ...raw })
  if (!parsed.success) {
    log.warn('app-store', 'state.json con valores no válidos; se usan los valores por defecto')
    return defaults()
  }
  return parsed.data
}

function writeAtomic(file: string, data: State): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

export function createAppStore(file: string, log: Pick<Logger, 'warn'> = defaultLogger): AppStore {
  let current = load(file, log)

  return {
    file,
    get: () => structuredClone(current),
    set(patch) {
      // Una clave presente pero `undefined` no borra el valor actual.
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      const next = StateSchema.parse({ ...current, ...defined })
      writeAtomic(file, next)
      current = next
      return structuredClone(current)
    }
  }
}
