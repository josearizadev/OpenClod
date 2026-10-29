import { watch as chokidarWatch } from 'chokidar'
import type { Stats } from 'node:fs'
import { existsSync } from 'node:fs'
import { sep } from 'node:path'
import { logger as defaultLogger, type Logger } from './logger'
import { t } from '../i18n'

/**
 * Vigilancia de `projects/` de la carpeta de Claude Code. Agrupa los
 * cambios en **ventanas fijas** de 300 ms: la primera notificación abre la ventana y no se
 * reinicia (Claude Code escribe sin parar durante un turno). Solo observa: nunca escribe ni
 * bloquea archivos. Si chokidar falla, pasa a `polling` y el main sondea.
 */

export type WatchState = 'watching' | 'polling' | 'off'

export interface WatchStatus {
  state: WatchState
  reason?: string
  lastEventAt?: string
}

/** Lo que el servicio usa de un `FSWatcher` de chokidar (inyectable en los tests). */
export interface FsWatcherLike {
  on(event: 'all', listener: (event: string, path: string) => void): unknown
  on(event: 'ready', listener: () => void): unknown
  on(event: 'error', listener: (error: unknown) => void): unknown
  close(): Promise<void>
}

export type CreateFsWatcher = (
  dir: string,
  options: { ignored: (path: string, stats?: Stats) => boolean; depth: number }
) => FsWatcherLike

export interface ClaudeWatcherOptions {
  projectsDir: () => string
  onBatch: (paths: string[]) => void
  createWatcher?: CreateFsWatcher
  exists?: (dir: string) => boolean
  /** Ventana de agrupado (ms). */
  windowMs?: number
  /** Tiempo máximo hasta `ready` (ms). */
  readyTimeoutMs?: number
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface ClaudeWatcher {
  start(): void
  restart(): void
  /**
   * Para la vigilancia y espera a que suelte las carpetas: en Windows no se puede renombrar una
   * carpeta vigilada (EPERM). Se vuelve a arrancar con `start`.
   */
  pause(): Promise<void>
  dispose(): void
  status(): WatchStatus
}

const EVENTS = new Set(['add', 'change', 'unlink', 'addDir', 'unlinkDir'])

/**
 * Filtro de rutas: fuera `tool-results/` y `memory/` y todo archivo que no sea `.jsonl` o
 * `.meta.json`. Las carpetas (o rutas sin `stats` que no parecen archivo) se recorren.
 */
export function isIgnored(path: string, stats?: Stats): boolean {
  const parts = path.split(/[\\/]/)
  if (parts.includes('tool-results') || parts.includes('memory')) return true
  const isFile = stats ? stats.isFile() : /\.[^\\/]+$/.test(path)
  if (!isFile) return false
  return !(path.endsWith('.jsonl') || path.endsWith('.meta.json'))
}

const defaultCreate: CreateFsWatcher = (dir, options) =>
  chokidarWatch(dir, { ignoreInitial: true, awaitWriteFinish: false, ...options })

export function createClaudeWatcher(options: ClaudeWatcherOptions): ClaudeWatcher {
  const log = options.log ?? defaultLogger
  const create = options.createWatcher ?? defaultCreate
  const exists = options.exists ?? existsSync
  const windowMs = options.windowMs ?? 300
  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000

  let watcher: FsWatcherLike | null = null
  let status: WatchStatus = { state: 'off', reason: t('Sin iniciar') }
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  function flush(): void {
    timer = null
    const paths = [...pending]
    pending = new Set()
    if (paths.length === 0) return
    try {
      options.onBatch(paths)
    } catch (error) {
      log.error('watch', error)
    }
  }

  function close(): Promise<void> {
    generation++
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
    if (timer) clearTimeout(timer)
    timer = null
    pending = new Set()
    const w = watcher
    watcher = null
    return (w?.close() ?? Promise.resolve()).catch((error) =>
      log.warn('watch', `No se pudo cerrar la vigilancia: ${error}`)
    )
  }

  function fail(reason: string): void {
    void close()
    status = { ...status, state: 'polling', reason }
    log.warn('watch', `Sin vigilancia (${reason}): se comprobará cada 30 s`)
  }

  function start(): void {
    void close()
    const dir = options.projectsDir()
    if (!exists(dir)) {
      status = { state: 'off', reason: t('No existe {dir}', { dir }) }
      log.info('watch', status.reason as string)
      return
    }
    const gen = generation
    try {
      const w = create(dir, { ignored: isIgnored, depth: 3 })
      watcher = w
      status = { state: 'watching' }
      w.on('all', (event, path) => {
        if (gen !== generation || !EVENTS.has(event)) return
        if (isIgnored(path, undefined) && !event.endsWith('Dir')) return
        pending.add(path)
        status = { ...status, lastEventAt: new Date().toISOString() }
        if (!timer) timer = setTimeout(flush, windowMs)
      })
      w.on('ready', () => {
        if (gen !== generation) return
        if (readyTimer) clearTimeout(readyTimer)
        readyTimer = null
        log.info('watch', `Vigilando ${dir}`)
      })
      w.on('error', (error) => {
        if (gen !== generation) return
        fail(error instanceof Error ? error.message : String(error))
      })
      readyTimer = setTimeout(() => {
        if (gen === generation) fail(t('La vigilancia no arrancó en 10 s'))
      }, readyTimeoutMs)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    start,
    restart: start,
    async pause() {
      await close()
      status = { state: 'off', reason: t('En pausa') }
    },
    dispose() {
      void close()
      status = { state: 'off', reason: 'Cerrada' }
    },
    status: () => ({ ...status })
  }
}

/** `projects/` dentro de la carpeta de Claude Code. */
export function projectsDirOf(claudeDir: string): string {
  return `${claudeDir.replace(/[\\/]+$/, '')}${sep}projects`
}
