import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate, type MenuDeps } from '../../src/main/menu'

function deps(overrides: Partial<MenuDeps> = {}): MenuDeps {
  return {
    platform: 'win32',
    dev: false,
    appName: 'OpenClod',
    send: vi.fn(),
    quit: vi.fn(),
    openLogs: vi.fn(),
    ...overrides
  }
}

function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flat(item.submenu as MenuItemConstructorOptions[]) : [])
  ])
}

function find(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const item = flat(items).find((i) => i.label === label)
  if (!item) throw new Error(`Sin «${label}»`)
  return item
}

const click = (item: MenuItemConstructorOptions): void => (item.click as unknown as () => void)()

describe('buildMenuTemplate', () => {
  it('Windows: Archivo, Editar, Ver, Ir y Ayuda; sin herramientas de desarrollo', () => {
    const template = buildMenuTemplate(deps())
    expect(template.map((m) => m.label)).toEqual(['Archivo', 'Editar', 'Ver', 'Ir', 'Ayuda'])
    expect(flat(template).some((i) => i.role === 'toggleDevTools')).toBe(false)
    expect(
      flat(buildMenuTemplate(deps({ dev: true }))).some((i) => i.role === 'toggleDevTools')
    ).toBe(true)
  })

  it('los atajos del renderer no se registran dos veces; Salir sí', () => {
    const template = buildMenuTemplate(deps())
    for (const label of ['Nueva sesión', 'Buscar', 'Uso', 'Ajustes…']) {
      expect(find(template, label).registerAccelerator, label).toBe(false)
    }
    expect(find(template, 'Salir')).toMatchObject({ accelerator: 'CmdOrCtrl+Q' })
    expect(find(template, 'Salir').registerAccelerator).toBeUndefined()
  })

  it('cada opción manda su orden; Salir y registros llaman a lo suyo', () => {
    const d = deps()
    const template = buildMenuTemplate(d)
    click(find(template, 'Nueva sesión'))
    click(find(template, 'Diagnóstico'))
    click(find(template, 'Acerca de OpenClod'))
    expect(d.send).toHaveBeenNthCalledWith(1, 'new-session')
    expect(d.send).toHaveBeenNthCalledWith(2, 'diagnostics')
    expect(d.send).toHaveBeenNthCalledWith(3, 'about')
    click(find(template, 'Salir'))
    click(find(template, 'Abrir la carpeta de registros'))
    expect(d.quit).toHaveBeenCalledOnce()
    expect(d.openLogs).toHaveBeenCalledOnce()
  })

  it('macOS: menú de la aplicación con Acerca de, Ajustes y Salir', () => {
    const template = buildMenuTemplate(deps({ platform: 'darwin' }))
    expect(template[0]?.label).toBe('OpenClod')
    const app = (template[0]?.submenu as MenuItemConstructorOptions[]).map((i) => i.label)
    expect(app).toContain('Acerca de OpenClod')
    expect(app).toContain('Ajustes…')
    expect(app).toContain('Salir de OpenClod')
  })
})
