import { BrowserWindow, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { buildCsp } from '../shared/csp'
import { logger } from './services/logger'
import icon from '../../resources/icon.png?asset'

/**
 * Colores nativos de la ventana. Reflejan los tokens `--bg` y `--text` de
 * tokens.css: el main no puede leer CSS y los necesita antes de pintar.
 * Los botones de la barra de título quedan sobre el panel principal, así que usan `--bg`.
 */
const WINDOW_COLORS = {
  light: { bg: '#FAF9F5', text: '#141413' },
  dark: { bg: '#262624', text: '#FAF9F5' }
} as const

/** Debe coincidir con la altura de `MainHeader` (h-12). */
const TITLE_BAR_HEIGHT = 48

function currentColors(): (typeof WINDOW_COLORS)['light' | 'dark'] {
  return nativeTheme.shouldUseDarkColors ? WINDOW_COLORS.dark : WINDOW_COLORS.light
}

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const appUrl = devServerUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** ¿Es `url` la página de la app? Se ignoran hash y query (el router usa hash). */
export function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url)
    const app = new URL(appUrl)
    if (target.protocol !== app.protocol) return false
    if (app.protocol === 'file:') return target.pathname === app.pathname
    return target.origin === app.origin
  } catch {
    return false
  }
}

/** Solo `http:` y `https:` se abren en el navegador del sistema. */
function openIfExternalWeb(url: string): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url)
    else logger.warn('window', `Enlace externo bloqueado (protocolo ${protocol})`)
  } catch {
    logger.warn('window', 'Enlace externo bloqueado (URL no válida)')
  }
}

/** Cabecera CSP y permisos de la sesión. Llamar una vez, antes de crear ventanas. */
export function hardenSession(): void {
  const csp = buildCsp({ dev: is.dev })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
  // Solo se concede escribir en el portapapeles (copiar el sessionId); nada de cámara,
  // micrófono, notificaciones, geolocalización…
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
}

export function createMainWindow(
  opts: { bounds?: { x: number; y: number; width: number; height: number } } = {}
): BrowserWindow {
  const colors = currentColors()
  const win = new BrowserWindow({
    ...(opts.bounds ?? { width: 1280, height: 820 }),
    minWidth: 900,
    minHeight: 600,
    // En Windows el icono sale del ejecutable; en desarrollo y en Linux, de aquí.
    ...(process.platform !== 'darwin' ? { icon } : {}),
    show: false,
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bg, symbolColor: colors.text, height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  })

  win.on('ready-to-show', () => win.show())

  const applyThemeColors = (): void => {
    const c = currentColors()
    win.setBackgroundColor(c.bg)
    win.setTitleBarOverlay({ color: c.bg, symbolColor: c.text, height: TITLE_BAR_HEIGHT })
  }
  nativeTheme.on('updated', applyThemeColors)
  win.on('closed', () => nativeTheme.off('updated', applyThemeColors))

  const contents = win.webContents
  contents.setWindowOpenHandler(({ url }) => {
    openIfExternalWeb(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openIfExternalWeb(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('render-process-gone', (_event, details) => {
    logger.error(
      'window',
      `Proceso de renderizado terminado: ${details.reason} (${details.exitCode})`
    )
  })

  void win.loadURL(appUrl)
  return win
}
