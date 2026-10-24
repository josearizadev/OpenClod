import type { IndexStatus, IndexUpdated } from '../../shared/projects'
import type { PassResult } from './indexer'
import { logger as defaultLogger, type Logger, type LogLevel } from './logger'
import { t } from '../i18n'

/**
 * Ciclo de vida del worker del índice. Como mucho una pasada en curso y una
 * pendiente: lo que se pide durante una pasada espera a la siguiente, que se lanza una sola vez
 * al terminar la actual y resuelve a todos. Un `rebuild` pendiente gana a un `pass`.
 * Sin dependencias de Electron: el worker y el aviso al renderer se inyectan.
 */

export interface WorkerData {
  dbFile: string
}

export type PassKind = 'pass' | 'rebuild'

export interface WorkerRequest {
  type: PassKind
  id: number
  claudeDir: string
}

export type WorkerResponse =
  | { type: 'done'; id: number; result: PassResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'log'; level: LogLevel; scope: string; message: string }
  | { type: 'progress'; id: number; done: number; total: number }

/** Lo que el servicio usa de un `Worker` de `node:worker_threads`. */
export interface IndexWorker {
  postMessage(message: WorkerRequest): void
  on(event: 'message', listener: (message: WorkerResponse) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

export interface IndexServiceOptions {
  createWorker: () => IndexWorker
  claudeDir: () => string
  /** Estado actual leído del índice (lector del main), con `running` ya resuelto. */
  status: (running: boolean) => IndexStatus
  /** Intervalo mínimo entre avisos de progreso (ms). */
  progressEveryMs?: number
  /** Aviso a las ventanas (`index:updated`). */
  notify: (payload: IndexUpdated) => void
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface IndexService {
  /** Pasada incremental, o se une a la que está en curso / pendiente. */
  refresh(): Promise<PassResult>
  /** Vacía el índice y lanza una pasada completa. */
  rebuild(): Promise<PassResult>
  status(): IndexStatus
  readonly running: boolean
  /** Progreso de la pasada larga en curso, si la hay. */
  readonly progress: { done: number; total: number } | null
  dispose(): Promise<void>
}

interface Waiter {
  resolve: (result: PassResult) => void
  reject: (error: Error) => void
}

interface Job {
  kind: PassKind
  waiters: Waiter[]
}

export function createIndexService(options: IndexServiceOptions): IndexService {
  const log = options.log ?? defaultLogger
  let worker: IndexWorker | null = null
  let current: (Job & { id: number }) | null = null
  let pending: Job | null = null
  let nextId = 1
  let disposed = false
  /** Progreso de la pasada larga en curso. */
  let progress: { done: number; total: number } | null = null
  let lastProgressAt = 0
  const progressEveryMs = options.progressEveryMs ?? 500

  function statusNow(): IndexStatus {
    const status = options.status(current !== null)
    return progress && current ? { ...status, progress } : status
  }

  function settle(outcome: { result: PassResult } | { error: Error }): void {
    const job = current
    current = null
    progress = null
    if (job) {
      for (const w of job.waiters) {
        if ('result' in outcome) w.resolve(outcome.result)
        else w.reject(outcome.error)
      }
    }
    const changed =
      'result' in outcome && outcome.result.changedSessions + outcome.result.removedSessions > 0
    safeNotify(changed)
    if (pending && !disposed) {
      const next = pending
      pending = null
      start(next)
    }
  }

  function safeNotify(changed: boolean): void {
    try {
      options.notify({ changed, status: statusNow() })
    } catch (error) {
      log.error('index', error)
    }
  }

  function ensureWorker(): IndexWorker {
    if (worker) return worker
    const created = options.createWorker()
    created.on('message', (message) => {
      if (message.type === 'log') {
        log[message.level](message.scope, message.message)
        return
      }
      if (!current || message.id !== current.id) return
      if (message.type === 'progress') {
        progress = { done: message.done, total: message.total }
        const now = Date.now()
        if (now - lastProgressAt >= progressEveryMs) {
          lastProgressAt = now
          safeNotify(false)
        }
        return
      }
      if (message.type === 'done') {
        const r = message.result
        log.info(
          'index',
          `Pasada ${current.kind === 'rebuild' ? 'completa' : 'incremental'} en ${r.durationMs} ms · ` +
            `${r.filesRead} archivos leídos · ${r.changedSessions} sesiones cambiadas · ` +
            `${r.removedSessions} quitadas${r.error ? ` · ${r.error}` : ''}`
        )
        settle({ result: r })
      } else {
        settle({ error: new Error(message.message) })
      }
    })
    const lost = (reason: string): void => {
      if (worker !== created) return
      worker = null
      if (disposed) return
      log.error('index', `El worker del índice terminó: ${reason}`)
      // Se recrea en la siguiente petición (o ya, si había una pendiente).
      if (current)
        settle({ error: new Error(t('El worker del índice terminó: {reason}', { reason })) })
    }
    created.on('error', (error) => lost(error.message))
    created.on('exit', (code) => lost(`código ${code}`))
    worker = created
    return created
  }

  function start(job: Job): void {
    const id = nextId++
    current = { ...job, id }
    try {
      ensureWorker().postMessage({ type: job.kind, id, claudeDir: options.claudeDir() })
    } catch (error) {
      log.error('index', error)
      settle({ error: error instanceof Error ? error : new Error(String(error)) })
      return
    }
    safeNotify(false)
  }

  function request(kind: PassKind): Promise<PassResult> {
    if (disposed) return Promise.reject(new Error(t('El índice se está cerrando')))
    return new Promise<PassResult>((resolve, reject) => {
      const waiter = { resolve, reject }
      if (!current) {
        start({ kind, waiters: [waiter] })
        return
      }
      if (!pending) pending = { kind, waiters: [] }
      if (kind === 'rebuild') pending.kind = 'rebuild'
      pending.waiters.push(waiter)
    })
  }

  return {
    refresh: () => request('pass'),
    rebuild: () => request('rebuild'),
    status: statusNow,
    get running() {
      return current !== null
    },
    get progress() {
      return current ? progress : null
    },
    async dispose() {
      disposed = true
      const closing = new Error(t('El índice se está cerrando'))
      for (const job of [current, pending]) for (const w of job?.waiters ?? []) w.reject(closing)
      current = null
      pending = null
      const w = worker
      worker = null
      if (w) await w.terminate()
    }
  }
}
