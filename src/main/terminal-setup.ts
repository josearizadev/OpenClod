import { app, webContents } from 'electron'
import { basename } from 'node:path'
import type { TerminalShells } from '../shared/terminal'
import type { TerminalSettings } from '../shared/types'
import { checkCwd } from './services/chat/claude-runtime'
import { resolveRoot, type RootDeps } from './services/file-access'
import { logger } from './services/logger'
import { createWhich, defaultDeps, detectShells, loginPath, type ShellInfo } from './services/shell'
import {
  createTerminalService,
  TerminalError,
  type SpawnPty,
  type TerminalService
} from './services/terminal'

/**
 * Monta la terminal de respaldo: carga node-pty (si falla, la app sigue sin
 * terminal), detecta los shells una vez y resuelve carpeta, entorno y `claude`.
 */
export interface TerminalSetupDeps extends RootDeps {
  settings: () => TerminalSettings
  /** Carpeta de Claude Code elegida en Ajustes (se pasa como `CLAUDE_CONFIG_DIR`). */
  customClaudeDir: () => string | null
  /** Binario de Claude Code que trae la app. */
  bundledClaude: string | null
  resumeTarget: (sessionId: string) => { sessionId: string; cwd: string } | null
  sessionTitle: (sessionId: string) => string | null
}

export interface TerminalSetup {
  service: TerminalService | null
  shells: () => Promise<TerminalShells>
}

function loadPty(): { spawn: SpawnPty } | { error: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- módulo nativo opcional
    const pty = require('node-pty') as { spawn: SpawnPty }
    return { spawn: pty.spawn }
  } catch (error) {
    logger.error('terminal', error)
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Variables que no deben llegar al shell del usuario. */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (/^(ELECTRON_|VITE_|NODE_OPTIONS$|CHROME_)/i.test(key)) continue
    out[key] = value
  }
  return out
}

export function setupTerminal(deps: TerminalSetupDeps): TerminalSetup {
  const loaded = loadPty()
  let detected: Promise<ShellInfo[]> | null = null
  const shellsList = (): Promise<ShellInfo[]> => (detected ??= detectShells(defaultDeps()))

  const shells = async (): Promise<TerminalShells> => {
    const list = await shellsList()
    return {
      available: list.map(({ id, label, path }) => ({ id, label, path })),
      default: list[0]?.id ?? null,
      ...('error' in loaded ? { error: loaded.error } : {})
    }
  }
  if ('error' in loaded) return { service: null, shells }

  const chosenShell = async (): Promise<ShellInfo> => {
    const list = await shellsList()
    const wanted = deps.settings().shell
    const shell = list.find((s) => s.id === wanted) ?? list[0]
    if (!shell) throw new TerminalError('No se encontró ningún shell')
    return shell
  }

  // El `PATH` del shell de inicio de sesión (macOS/Linux) y dónde está `claude`: una vez.
  let pathPromise: Promise<string | null> | null = null
  const userPath = (): Promise<string | null> => {
    if (process.platform === 'win32') return Promise.resolve(process.env['PATH'] ?? null)
    return (pathPromise ??= chosenShell().then((s) => loginPath(s.path)))
  }
  const env = async (): Promise<Record<string, string>> => {
    const out = cleanEnv(process.env)
    const path = await userPath()
    if (path) out[process.platform === 'win32' && 'Path' in out ? 'Path' : 'PATH'] = path
    out['TERM'] = 'xterm-256color'
    out['COLORTERM'] = 'truecolor'
    const custom = deps.customClaudeDir()
    if (custom) out['CLAUDE_CONFIG_DIR'] = custom
    return out
  }
  let claudePromise: Promise<boolean> | null = null
  const claude = async (): Promise<{ onPath: boolean; bundled: string | null }> => {
    claudePromise ??= env().then(
      async (e) => (await createWhich(process.platform, e)('claude')) !== null
    )
    return { onPath: await claudePromise, bundled: deps.bundledClaude }
  }

  const service = createTerminalService({
    spawn: loaded.spawn,
    shell: chosenShell,
    env,
    claude,
    resolve: async (input) => {
      if (input.kind === 'resume' && input.target && 'sessionId' in input.target) {
        const id = input.target.sessionId
        const target = deps.resumeTarget(id)
        const cwd = target?.cwd ?? deps.sessionCwd(id)
        if (!cwd) throw new TerminalError('No se encontró la carpeta de la sesión')
        const checked = await checkCwd(cwd, deps.claudeDir())
        if (!checked.ok) throw new TerminalError('La carpeta de la sesión ya no existe')
        return {
          cwd: checked.path,
          label: deps.sessionTitle(id) ?? 'sesión',
          sessionId: target?.sessionId ?? id
        }
      }
      if (input.target) {
        const cwd = await resolveRoot(input.target, deps)
        return { cwd, label: basename(cwd) || cwd }
      }
      const home = app.getPath('home')
      return { cwd: home, label: basename(home) || home }
    },
    send: (owner, channel, payload) => {
      const contents = webContents.fromId(owner)
      if (contents && !contents.isDestroyed()) contents.send(channel, payload)
    },
    log: logger
  })
  return { service, shells }
}
