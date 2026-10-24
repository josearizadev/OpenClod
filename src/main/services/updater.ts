import type { UpdateStatus } from '../../shared/update'
import type { Logger } from './logger'
import { t } from '../i18n'

/**
 * Actualizaciones de la app con `electron-updater`. Busca al arrancar y cada pocas horas,
 * descarga sola la versión nueva y la deja lista: se instala al reiniciar desde la app o, si no,
 * al salir. El `autoUpdater` llega inyectado para poder probarlo sin Electron.
 */

/** Lo que se usa de `autoUpdater` (electron-updater). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown
  on(event: 'update-not-available', listener: () => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface AppUpdaterOptions {
  /** `null` en desarrollo: la app no se actualiza y el estado es `disabled`. */
  updater: UpdaterLike | null
  emit: (status: UpdateStatus) => void
  log: Logger
  now?: () => Date
  /** Primera búsqueda tras arrancar. */
  firstCheckMs?: number
  intervalMs?: number
}

export interface AppUpdater {
  status(): UpdateStatus
  start(): void
  /** Búsqueda a mano («Buscar actualizaciones»). No hace nada si ya hay una lista o en curso. */
  check(): Promise<void>
  /** Cierra la app, instala en silencio y la vuelve a abrir. Solo con una versión lista. */
  install(): boolean
  dispose(): void
}

const FIRST_CHECK_MS = 10_000
const INTERVAL_MS = 4 * 60 * 60 * 1000

/** Mensaje corto para la interfaz; el detalle va al log. */
function shortMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|net::ERR_/i.test(text)) {
    return t('No se pudo conectar con el servidor de actualizaciones.')
  }
  if (/\b404\b/.test(text)) return t('El servidor no tiene información de versiones.')
  return t('No se pudo comprobar si hay actualizaciones.')
}

export function createAppUpdater(options: AppUpdaterOptions): AppUpdater {
  const { updater, emit, log } = options
  const now = options.now ?? (() => new Date())
  let current: UpdateStatus = updater ? { state: 'idle' } : { state: 'disabled' }
  let firstTimer: ReturnType<typeof setTimeout> | null = null
  let interval: ReturnType<typeof setInterval> | null = null

  const set = (next: UpdateStatus): void => {
    current = next
    emit(next)
  }

  if (updater) {
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => {
      if (current.state !== 'downloading') set({ state: 'checking' })
    })
    updater.on('update-available', (info) => {
      log.info('update', `Versión nueva disponible: ${info.version}`)
      set({ state: 'downloading', version: info.version, percent: 0 })
    })
    updater.on('update-not-available', () =>
      set({ state: 'latest', checkedAt: now().toISOString() })
    )
    updater.on('download-progress', (progress) => {
      if (current.state !== 'downloading') return
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
      if (percent !== current.percent) set({ ...current, percent })
    })
    updater.on('update-downloaded', (info) => {
      log.info('update', `Versión ${info.version} descargada`)
      set({ state: 'ready', version: info.version })
    })
    updater.on('error', (error) => {
      log.error('update', error)
      // Una descarga ya terminada sigue valiendo aunque falle una búsqueda posterior.
      if (current.state !== 'ready') set({ state: 'error', message: shortMessage(error) })
    })
  }

  const check = async (): Promise<void> => {
    if (!updater) return
    if (['ready', 'downloading', 'checking'].includes(current.state)) return
    try {
      await updater.checkForUpdates()
    } catch (error) {
      // electron-updater también emite `error`; esto cubre los fallos antes de emitir.
      log.error('update', error)
      if (current.state !== 'ready') set({ state: 'error', message: shortMessage(error) })
    }
  }

  return {
    status: () => current,
    start() {
      if (!updater || firstTimer || interval) return
      firstTimer = setTimeout(() => {
        firstTimer = null
        void check()
      }, options.firstCheckMs ?? FIRST_CHECK_MS)
      interval = setInterval(() => void check(), options.intervalMs ?? INTERVAL_MS)
    },
    check,
    install() {
      if (!updater || current.state !== 'ready') return false
      log.info('update', `Reinicio para instalar ${current.version}`)
      updater.quitAndInstall(true, true)
      return true
    },
    dispose() {
      if (firstTimer) clearTimeout(firstTimer)
      if (interval) clearInterval(interval)
      firstTimer = null
      interval = null
    }
  }
}
