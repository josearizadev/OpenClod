import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { ShellMenuStatus } from '../../shared/types'

/**
 * «Abrir en OpenClod» en el clic derecho del Explorador de Windows. Solo el usuario actual
 * (`HKCU`, sin administrador). El registro es la única verdad: no hay copia en `state.json`.
 * Las claves se escriben con `reg.exe`, que se inyecta en los tests.
 */

const ROOT = 'HKCU\\Software\\Classes\\Directory'
/** Clic derecho sobre una carpeta (`%1`) y sobre el fondo de una carpeta abierta (`%V`). */
export const SHELL_MENU_KEYS = [
  { key: `${ROOT}\\shell\\OpenClod`, arg: '%1' },
  { key: `${ROOT}\\Background\\shell\\OpenClod`, arg: '%V' }
] as const

/** Ejecuta `reg.exe` con esos argumentos; `ok: false` si termina con error (p. ej. no existe). */
export type RegRunner = (args: string[]) => Promise<{ ok: boolean; stdout: string }>

export const runReg: RegRunner = (args) =>
  new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 10_000 }, (error, stdout) =>
      resolve({ ok: !error, stdout: String(stdout ?? '') })
    )
  })

export interface ShellMenuDeps {
  platform: NodeJS.Platform
  packaged: boolean
  /** Ejecutable de la app instalada. */
  exePath: string
  reg: RegRunner
}

export interface ShellMenuService {
  status(): Promise<ShellMenuStatus>
  enable(label: string): Promise<ShellMenuStatus>
  disable(): Promise<ShellMenuStatus>
  /** Si la entrada existe y difiere (otro ejecutable, otro idioma), la reescribe. */
  sync(label: string): Promise<void>
}

/** Valor `REG_SZ` de una salida de `reg query … /ve` (el nombre del valor va traducido). */
export function parseRegDefault(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /\sREG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line)
    if (match) return (match[1] ?? '').trimEnd()
  }
  return null
}

export function commandFor(exePath: string, arg: string): string {
  return `"${exePath}" "${arg}"`
}

export function createShellMenu(deps: ShellMenuDeps): ShellMenuService {
  const unsupported = (): ShellMenuStatus['reason'] | null => {
    if (deps.platform !== 'win32') return 'platform'
    if (!deps.packaged) return 'dev'
    return null
  }

  const readDefault = async (key: string): Promise<string | null> => {
    const result = await deps.reg(['query', key, '/ve'])
    return result.ok ? parseRegDefault(result.stdout) : null
  }

  const status = async (): Promise<ShellMenuStatus> => {
    const reason = unsupported()
    if (reason) return { supported: false, reason, enabled: false }
    const [first] = SHELL_MENU_KEYS
    const enabled = (await deps.reg(['query', first.key])).ok
    return { supported: true, enabled }
  }

  const write = async (label: string): Promise<boolean> => {
    let ok = true
    for (const { key, arg } of SHELL_MENU_KEYS) {
      const steps = [
        ['add', key, '/ve', '/t', 'REG_SZ', '/d', label, '/f'],
        ['add', key, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${deps.exePath}",0`, '/f'],
        ['add', `${key}\\command`, '/ve', '/t', 'REG_SZ', '/d', commandFor(deps.exePath, arg), '/f']
      ]
      for (const step of steps) ok = (await deps.reg(step)).ok && ok
    }
    return ok
  }

  const remove = async (): Promise<void> => {
    for (const { key } of SHELL_MENU_KEYS) await deps.reg(['delete', key, '/f'])
  }

  return {
    status,
    async enable(label) {
      if (unsupported()) return status()
      if (!(await write(label))) {
        await remove()
        throw new Error('No se pudo escribir en el registro.')
      }
      return status()
    },
    async disable() {
      if (unsupported()) return status()
      await remove()
      return status()
    },
    async sync(label) {
      if (!(await status()).enabled) return
      for (const { key, arg } of SHELL_MENU_KEYS) {
        const [text, command] = await Promise.all([
          readDefault(key),
          readDefault(`${key}\\command`)
        ])
        if (text !== label || command !== commandFor(deps.exePath, arg)) {
          await write(label)
          return
        }
      }
    }
  }
}

/**
 * Carpeta pasada como argumento al abrir la app («Abrir en OpenClod» o `openclod.exe <carpeta>`).
 * Se salta el ejecutable (y en desarrollo el script) y los `--switches` que añade Chromium.
 */
export function folderFromArgv(argv: readonly string[], packaged: boolean): string | null {
  for (const raw of argv.slice(packaged ? 1 : 2)) {
    if (raw.startsWith('-')) continue
    // `"C:\"` llega como `C:"`: la barra final escapa la comilla.
    let arg = raw.trim().replace(/"+$/, '')
    if (/^[a-zA-Z]:$/.test(arg)) arg += '\\'
    if (arg && (isAbsolute(arg) || /^[a-zA-Z]:\\/.test(arg))) return arg
  }
  return null
}
