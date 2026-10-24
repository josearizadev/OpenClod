import { execFile } from 'node:child_process'
import type { AuthStatus } from '../../shared/auth'

/**
 * Sesión de Claude Code: se pregunta a la propia CLI con `claude auth status --json`. La app no
 * lee archivos de credenciales; de la respuesta solo se copian estado, método, correo, plan y
 * proveedor (nunca el id de organización).
 */

const TIMEOUT_MS = 20_000

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : undefined
}

/** Interpreta la salida JSON. Cualquier cosa inesperada → `unknown`. */
export function parseAuthStatus(stdout: string): AuthStatus {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return { state: 'unknown' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unknown' }
  const data = raw as Record<string, unknown>
  if (typeof data['loggedIn'] !== 'boolean') return { state: 'unknown' }
  const method = text(data['authMethod'])
  const provider = text(data['apiProvider'])
  if (!data['loggedIn']) return { state: 'out', ...(provider ? { provider } : {}) }
  const email = text(data['email'])
  const plan = text(data['subscriptionType'])
  return {
    state: 'in',
    ...(method && method !== 'none' ? { method } : {}),
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
    ...(provider ? { provider } : {})
  }
}

export interface AuthDeps {
  /** Binario de Claude Code que trae la app; `null` → `claude` del PATH. */
  claudePath: string | null
  /** Carpeta personalizada de Claude Code (se pasa como `CLAUDE_CONFIG_DIR`). */
  customClaudeDir: () => string | null
  env?: NodeJS.ProcessEnv
}

export function readAuthStatus(deps: AuthDeps): Promise<AuthStatus> {
  const env = { ...(deps.env ?? process.env) }
  const custom = deps.customClaudeDir()
  if (custom) env['CLAUDE_CONFIG_DIR'] = custom
  return new Promise((resolve) => {
    execFile(
      deps.claudePath ?? 'claude',
      ['auth', 'status', '--json'],
      { timeout: TIMEOUT_MS, windowsHide: true, env, maxBuffer: 64 * 1024 },
      // Sin sesión sale con código 1 pero escribe el JSON igualmente.
      (_error, stdout) => resolve(parseAuthStatus(String(stdout ?? '')))
    )
  })
}
