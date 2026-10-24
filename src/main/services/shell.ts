import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ShellOption } from '../../shared/terminal'
import { t } from '../i18n'

/**
 * Shell del usuario y la orden de Claude Code para la terminal. Puro salvo
 * las funciones que lanzan procesos (`which`, `loginPath`), que se inyectan en los tests.
 */

export type ShellKind = 'powershell' | 'cmd' | 'posix'

export interface ShellInfo extends ShellOption {
  kind: ShellKind
}

export type Which = (command: string) => Promise<string | null>

export interface DetectDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  which: Which
  exists: (path: string) => boolean
}

export function shellKindOf(path: string): ShellKind {
  const name = basename(path).toLowerCase()
  if (name.startsWith('pwsh') || name.startsWith('powershell')) return 'powershell'
  if (name === 'cmd.exe' || name === 'cmd') return 'cmd'
  return 'posix'
}

/** Shells instalados, el preferido primero. */
export async function detectShells(deps: DetectDeps): Promise<ShellInfo[]> {
  const out: ShellInfo[] = []
  const add = (id: string, label: string, path: string | null | undefined): void => {
    if (!path || !deps.exists(path) || out.some((s) => s.path === path)) return
    out.push({ id, label, path, kind: shellKindOf(path) })
  }
  if (deps.platform === 'win32') {
    const root = deps.env['SystemRoot'] ?? 'C:\\Windows'
    add('pwsh', 'PowerShell 7', await deps.which('pwsh.exe'))
    add(
      'powershell',
      'Windows PowerShell',
      join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    )
    add('cmd', t('Símbolo del sistema'), deps.env['ComSpec'] ?? join(root, 'System32', 'cmd.exe'))
    const programFiles = deps.env['ProgramFiles'] ?? 'C:\\Program Files'
    add('git-bash', 'Git Bash', join(programFiles, 'Git', 'bin', 'bash.exe'))
  } else {
    const user = deps.env['SHELL']
    if (user) add(basename(user), basename(user), user)
    for (const path of ['/bin/zsh', '/bin/bash', '/bin/sh'])
      add(basename(path), basename(path), path)
  }
  return out
}

export function shellArgs(shell: Pick<ShellInfo, 'kind' | 'path'>): string[] {
  if (shell.kind === 'powershell') return ['-NoLogo']
  if (shell.kind === 'cmd') return []
  return ['-l']
}

const SESSION_ID = /^[A-Za-z0-9-]{1,100}$/

function quote(kind: ShellKind, path: string): string {
  if (kind === 'powershell') return `& '${path.replace(/'/g, "''")}'`
  if (kind === 'cmd') return `"${path}"`
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/**
 * Orden que se escribe en el shell: `claude` si está en el `PATH`; si no, el binario
 * que trae la app con la sintaxis de invocación del shell. `null` si no hay ninguno o el id no
 * es válido.
 */
export function claudeLine(
  kind: ShellKind,
  claude: { onPath: boolean; bundled: string | null },
  sessionId?: string
): string | null {
  if (sessionId !== undefined && !SESSION_ID.test(sessionId)) return null
  const exe = claude.onPath ? 'claude' : claude.bundled ? quote(kind, claude.bundled) : null
  if (!exe) return null
  return sessionId ? `${exe} --resume ${sessionId}` : exe
}

/**
 * Orden para iniciar sesión: `claude auth login` y, al terminar, cerrar el shell. Prefiere el
 * binario de la app, de la misma versión que usa el chat: una CLI antigua del `PATH` tomaría
 * «auth login» como un prompt.
 */
export function claudeLoginLine(
  kind: ShellKind,
  claude: { onPath: boolean; bundled: string | null }
): string | null {
  const exe = claude.bundled ? quote(kind, claude.bundled) : claude.onPath ? 'claude' : null
  if (!exe) return null
  return `${exe} auth login${kind === 'cmd' ? ' & exit' : '; exit'}`
}

const TIMEOUT_MS = 3000

/** `where` / `which` con 3 s de tiempo límite; primera ruta encontrada. */
export function createWhich(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Which {
  return (command) =>
    new Promise((resolve) => {
      execFile(
        platform === 'win32' ? 'where' : 'which',
        [command],
        { timeout: TIMEOUT_MS, windowsHide: true, env },
        (error, stdout) => {
          const first = String(stdout ?? '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find(Boolean)
          resolve(error || !first ? null : first)
        }
      )
    })
}

/** `PATH` del shell de inicio de sesión (macOS/Linux): las apps gráficas no lo heredan. */
export function loginPath(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', 'printf %s "$PATH"'],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? null : String(stdout).trim() || null)
    )
  })
}

export function defaultDeps(): DetectDeps {
  return {
    platform: process.platform,
    env: process.env,
    which: createWhich(process.platform, process.env),
    exists: existsSync
  }
}
