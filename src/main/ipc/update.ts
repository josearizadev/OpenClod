import type { AppUpdater } from '../services/updater'
import { handle } from './handle'

/** Actualizaciones: estado, búsqueda a mano y reinicio para instalar. */
export function registerUpdateIpc(updater: AppUpdater, opts: { restart: () => void }): void {
  handle('update:status', () => updater.status())
  handle('update:check', () => updater.check())
  handle('update:install', () => opts.restart())
}
