import { nativeTheme } from 'electron'
import type { Settings, State } from '../../shared/types'
import type { AppStore } from '../services/app-store'
import { handle } from './handle'

/** Solo los ajustes salen por este canal; los proyectos tienen el suyo. */
function toSettings({
  theme,
  language,
  welcomed,
  claudeDir,
  viewer,
  chat,
  search,
  usage,
  notifications,
  terminal,
  window
}: State): Settings {
  return {
    theme,
    language,
    welcomed,
    claudeDir,
    viewer,
    chat,
    search,
    usage,
    notifications,
    terminal,
    window
  }
}

/** `onClaudeDirChanged` se llama si cambia `claudeDir` (el main reconstruye el índice). */
export function registerSettingsIpc(
  store: AppStore,
  onClaudeDirChanged?: () => void,
  /** Tras cada cambio (p. ej. la bandeja aparece o se va). */
  onChanged?: (settings: Settings) => void
): void {
  handle('settings:get', () => toSettings(store.get()))
  handle('settings:set', (patch) => {
    const before = store.get().claudeDir
    const settings = toSettings(store.set(patch))
    if (settings.claudeDir !== before) onClaudeDirChanged?.()
    // Cambiar `themeSource` emite `updated`: la ventana recolorea su barra de título (window.ts)
    // y el `prefers-color-scheme` del renderer cambia.
    nativeTheme.themeSource = settings.theme
    onChanged?.(settings)
    return settings
  })
}
