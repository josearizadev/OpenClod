import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../shared/types'

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
    label: mac ? `Salir de ${deps.appName}` : 'Salir',
    accelerator: 'CmdOrCtrl+Q',
    click: () => deps.quit()
  }
  const about = ui(`Acerca de ${deps.appName}`, 'about')
  const settings = ui('Ajustes…', 'settings', 'CmdOrCtrl+,')

  const template: MenuItemConstructorOptions[] = []
  if (mac) {
    template.push({
      label: deps.appName,
      submenu: [
        about,
        { type: 'separator' },
        settings,
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${deps.appName}` },
        { role: 'hideOthers', label: 'Ocultar otras' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        quit
      ]
    })
  }
  template.push(
    {
      label: 'Archivo',
      submenu: [
        ui('Nueva sesión', 'new-session', 'CmdOrCtrl+N'),
        ui('Importar carpeta de proyecto…', 'open-project'),
        ui('Terminal', 'terminal', 'CmdOrCtrl+`'),
        ...(mac ? [] : ([{ type: 'separator' }, settings, { type: 'separator' }, quit] as const))
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        ui('Buscar', 'search', 'CmdOrCtrl+K'),
        { type: 'separator' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(deps.dev
          ? ([
              { type: 'separator' },
              { role: 'reload', label: 'Recargar' },
              { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }
            ] as const)
          : [])
      ]
    },
    {
      label: 'Ir',
      submenu: [
        ui('Uso', 'usage', 'CmdOrCtrl+U'),
        ui('Terminal', 'terminal'),
        ui('Diagnóstico', 'diagnostics')
      ]
    },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        ...(mac ? [] : [about]),
        { label: 'Abrir la carpeta de registros', click: () => deps.openLogs() }
      ]
    }
  )
  return template
}
