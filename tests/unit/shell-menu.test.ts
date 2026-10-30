import { describe, expect, it } from 'vitest'
import {
  commandFor,
  createShellMenu,
  folderFromArgv,
  parseRegDefault,
  type RegRunner,
  type ShellMenuDeps,
  type ShellMenuService
} from '../../src/main/services/shell-menu'

const EXE = 'C:\\Users\\ana\\AppData\\Local\\Programs\\OpenClod\\openclod.exe'

/** Registro en memoria: clave → valores (`''` = predeterminado). */
function fakeReg(): { reg: RegRunner; keys: Map<string, Map<string, string>>; calls: string[][] } {
  const keys = new Map<string, Map<string, string>>()
  const calls: string[][] = []
  const reg: RegRunner = async (args) => {
    calls.push(args)
    const [op, key = ''] = args
    if (op === 'add') {
      const values = keys.get(key) ?? new Map<string, string>()
      const name = args.includes('/ve') ? '' : (args[args.indexOf('/v') + 1] ?? '')
      values.set(name, args[args.indexOf('/d') + 1] ?? '')
      keys.set(key, values)
      return { ok: true, stdout: '' }
    }
    if (op === 'delete') {
      const found = [...keys.keys()].filter((k) => k === key || k.startsWith(`${key}\\`))
      for (const k of found) keys.delete(k)
      return { ok: found.length > 0, stdout: '' }
    }
    const values = keys.get(key)
    if (!values) return { ok: false, stdout: '' }
    const value = values.get('')
    return {
      ok: true,
      stdout: `\r\n${key}\r\n    (Predeterminado)    REG_SZ    ${value ?? ''}\r\n`
    }
  }
  return { reg, keys, calls }
}

describe('folderFromArgv', () => {
  it('toma la carpeta tras el ejecutable y salta los switches', () => {
    expect(folderFromArgv([EXE, '--allow-file-access', 'C:\\proyectos\\web'], true)).toBe(
      'C:\\proyectos\\web'
    )
  })
  it('sin carpeta, o con argumentos relativos, devuelve null', () => {
    expect(folderFromArgv([EXE], true)).toBeNull()
    expect(folderFromArgv([EXE, 'relativa'], true)).toBeNull()
  })
  it('en desarrollo salta también el script', () => {
    expect(folderFromArgv(['electron.exe', 'Z:\\app', 'D:\\datos'], false)).toBe('D:\\datos')
  })
  it('repara la raíz de una unidad con la comilla escapada', () => {
    expect(folderFromArgv([EXE, 'C:"'], true)).toBe('C:\\')
  })
})

describe('parseRegDefault', () => {
  it('lee el valor aunque el nombre vaya traducido y tenga espacios', () => {
    expect(parseRegDefault('HKEY\r\n    (Default)    REG_SZ    "C:\\a b\\x.exe" "%1"\r\n')).toBe(
      '"C:\\a b\\x.exe" "%1"'
    )
    expect(parseRegDefault('nada')).toBeNull()
  })
})

describe('createShellMenu', () => {
  const make = (
    over: Partial<ShellMenuDeps> = {}
  ): ReturnType<typeof fakeReg> & { menu: ShellMenuService } => {
    const fake = fakeReg()
    const menu = createShellMenu({
      platform: 'win32',
      packaged: true,
      exePath: EXE,
      reg: fake.reg,
      ...over
    })
    return { ...fake, menu }
  }

  it('fuera de Windows o en desarrollo no toca el registro', async () => {
    const mac = make({ platform: 'darwin' })
    expect(await mac.menu.enable('Abrir')).toEqual({
      supported: false,
      reason: 'platform',
      enabled: false
    })
    const dev = make({ packaged: false })
    expect((await dev.menu.status()).reason).toBe('dev')
    expect([...mac.calls, ...dev.calls]).toEqual([])
  })

  it('activar escribe carpeta y fondo con icono; desactivar las quita', async () => {
    const { menu, keys } = make()
    expect((await menu.status()).enabled).toBe(false)
    expect((await menu.enable('Abrir en OpenClod')).enabled).toBe(true)
    const folder = 'HKCU\\Software\\Classes\\Directory\\shell\\OpenClod'
    const background = 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\OpenClod'
    expect(keys.get(folder)?.get('')).toBe('Abrir en OpenClod')
    expect(keys.get(folder)?.get('Icon')).toBe(`"${EXE}",0`)
    expect(keys.get(`${folder}\\command`)?.get('')).toBe(commandFor(EXE, '%1'))
    expect(keys.get(`${background}\\command`)?.get('')).toBe(`"${EXE}" "%V"`)
    expect((await menu.disable()).enabled).toBe(false)
    expect(keys.size).toBe(0)
  })

  it('sync reescribe solo si cambió el texto o el ejecutable', async () => {
    const { menu, calls, keys } = make()
    await menu.sync('Abrir')
    expect(calls.some((c) => c[0] === 'add')).toBe(false)
    await menu.enable('Abrir en OpenClod')
    const before = calls.length
    await menu.sync('Abrir en OpenClod')
    expect(calls.slice(before).some((c) => c[0] === 'add')).toBe(false)
    await menu.sync('Open in OpenClod')
    expect(keys.get('HKCU\\Software\\Classes\\Directory\\shell\\OpenClod')?.get('')).toBe(
      'Open in OpenClod'
    )
  })

  it('si falla una escritura, deshace y avisa', async () => {
    const fake = fakeReg()
    const menu = createShellMenu({
      platform: 'win32',
      packaged: true,
      exePath: EXE,
      reg: async (args) =>
        args[0] === 'add' && args.includes('Icon') ? { ok: false, stdout: '' } : fake.reg(args)
    })
    await expect(menu.enable('Abrir')).rejects.toThrow()
    expect(fake.keys.size).toBe(0)
  })
})
