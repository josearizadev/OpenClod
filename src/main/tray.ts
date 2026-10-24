import { Menu, nativeImage, Tray } from 'electron'
import { t } from './i18n'

/**
 * Icono de la bandeja. Solo existe con «Mantener en la bandeja
 * al cerrar» activado.
 */
export interface TrayDeps {
  /** PNG del icono (con su `@2x` al lado). */
  icon: string
  onShow: () => void
  onNewSession: () => void
  /** Pasa por la confirmación de cierre. */
  onQuit: () => void
  /** «2 sesiones trabajando» o `null`. */
  status: () => string | null
}

export interface AppTray {
  /** Reconstruye el menú (estado de los chats). */
  update(): void
  dispose(): void
}

export function createTray(deps: TrayDeps): AppTray {
  const tray = new Tray(nativeImage.createFromPath(deps.icon))
  tray.setToolTip('OpenClod')
  let last: string | null | undefined

  const build = (): void => {
    const status = deps.status()
    if (status === last) return
    last = status
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('Mostrar OpenClod'), click: deps.onShow },
        { label: t('Nueva sesión'), click: deps.onNewSession },
        ...(status ? [{ type: 'separator' as const }, { label: status, enabled: false }] : []),
        { type: 'separator' },
        { label: t('Salir'), click: deps.onQuit }
      ])
    )
    tray.setToolTip(status ? `OpenClod · ${status}` : 'OpenClod')
  }

  // En Windows el clic simple también abre: es lo que se espera de un icono de la bandeja.
  tray.on('click', deps.onShow)
  tray.on('double-click', deps.onShow)
  build()
  return {
    update: build,
    dispose: () => tray.destroy()
  }
}
