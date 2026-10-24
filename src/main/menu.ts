import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../shared/types'
import { t } from './i18n'

/**
 * Menú de la aplicación. Puro: devuelve la plantilla. Los
 * atajos que ya gestiona la interfaz se muestran con `registerAccelerator: false` para que no se
 * disparen dos veces; su clic manda `app:command` a la ventana.
 */
export interface MenuDeps {
  platform: NodeJS.Platform
  dev: boolean
  appName: string
  send: (command: AppCommand) => void
  /** «Salir» pasa por la confirmación de cierre. */
  quit: () => void
  openLogs: () => void
}

export function buildMenuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  const mac = deps.platform === 'darwin'
  const ui = (
    label: string,
    command: AppCommand,
    accelerator?: string
  ): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => deps.send(command)
  })
  const quit: MenuItemConstructorOptions = {
    label: mac ? t('Salir de {app}', { app: deps.appName }) : t('Salir'),
    accelerator: 'CmdOrCtrl+Q',
    click: () => deps.quit()
  }
  const about = ui(t('Acerca de {app}', { app: deps.appName }), 'about')
  const settings = ui(t('Ajustes…'), 'settings', 'CmdOrCtrl+,')

  const template: MenuItemConstructorOptions[] = []
  if (mac) {
    template.push({
      label: deps.appName,
      submenu: [
        about,
        { type: 'separator' },
        settings,
        { type: 'separator' },
        { role: 'hide', label: t('Ocultar {app}', { app: deps.appName }) },
        { role: 'hideOthers', label: t('Ocultar otras') },
        { role: 'unhide', label: t('Mostrar todo') },
        { type: 'separator' },
        quit
      ]
    })
  }
  template.push(
    {
      label: t('Archivo'),
      submenu: [
        ui(t('Nueva sesión'), 'new-session', 'CmdOrCtrl+N'),
        ui(t('Importar carpeta de proyecto…'), 'open-project'),
        ui(t('Terminal'), 'terminal', 'CmdOrCtrl+`'),
        ...(mac ? [] : ([{ type: 'separator' }, settings, { type: 'separator' }, quit] as const))
      ]
    },
    {
      label: t('Editar'),
      submenu: [
        { role: 'undo', label: t('Deshacer') },
        { role: 'redo', label: t('Rehacer') },
        { type: 'separator' },
        { role: 'cut', label: t('Cortar') },
        { role: 'copy', label: t('Copiar') },
        { role: 'paste', label: t('Pegar') },
        { role: 'selectAll', label: t('Seleccionar todo') }
      ]
    },
    {
      label: t('Ver'),
      submenu: [
        ui(t('Buscar'), 'search', 'CmdOrCtrl+K'),
        { type: 'separator' },
        { role: 'zoomIn', label: t('Acercar') },
        { role: 'zoomOut', label: t('Alejar') },
        { role: 'resetZoom', label: t('Tamaño real') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Pantalla completa') },
        ...(deps.dev
          ? ([
              { type: 'separator' },
              { role: 'reload', label: t('Recargar') },
              { role: 'toggleDevTools', label: t('Herramientas de desarrollo') }
            ] as const)
          : [])
      ]
    },
    {
      label: t('Ir'),
      submenu: [
        ui(t('Uso'), 'usage', 'CmdOrCtrl+U'),
        ui(t('Terminal'), 'terminal'),
        ui(t('Diagnóstico'), 'diagnostics')
      ]
    },
    {
      role: 'help',
      label: t('Ayuda'),
      submenu: [
        ...(mac ? [] : [about]),
        { label: t('Abrir la carpeta de registros'), click: () => deps.openLogs() }
      ]
    }
  )
  return template
}
