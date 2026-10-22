import { realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { unsafeToOpen, type FileTarget } from '../../shared/files'
import { checkCwd } from './chat/claude-runtime'
import { isInside } from './paths'

/**
 * Qué archivos puede leer la app. El renderer manda un destino; el
 * main resuelve la raíz y solo acepta rutas que, ya resueltas, caen dentro de ella (o de su
 * repositorio Git) y fuera de la carpeta de Claude Code.
 */

export class FileAccessError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_CWD',
    message: string
  ) {
    super(message)
    this.name = 'FileAccessError'
  }
}

export interface RootDeps {
  /** Carpeta de la sesión (índice, `resumeTarget` o chat activo). */
  sessionCwd(sessionId: string): string | null
  projectPath(projectId: string): string | null
  claudeDir(): string
}

/** Raíz real (sin enlaces) del destino; lanza si no existe o es la carpeta de Claude Code. */
export async function resolveRoot(target: FileTarget, deps: RootDeps): Promise<string> {
  const root =
    'sessionId' in target ? deps.sessionCwd(target.sessionId) : deps.projectPath(target.projectId)
  if (!root) throw new FileAccessError('NOT_FOUND', 'No se encontró la carpeta')
  const checked = await checkCwd(root, deps.claudeDir())
  if (!checked.ok) {
    throw new FileAccessError(
      'INVALID_CWD',
      checked.reason === 'claude-dir'
        ? 'No se puede leer la carpeta de Claude Code.'
        : 'La carpeta ya no existe.'
    )
  }
  return checked.path
}

export type Resolved =
  { ok: true; abs: string; display: string; exists: boolean } | { ok: false; display: string }

function slashed(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Ruta mostrada: relativa a la primera raíz que la contiene, con `/`. */
function displayPath(abs: string, roots: string[]): string {
  const root = roots.find((r) => isInside(abs, r))
  return root ? slashed(relative(root, abs)) || '.' : slashed(abs)
}

/**
 * Resuelve `path` (absoluta o relativa a `roots[0]`) y comprueba que, antes y después de seguir
 * enlaces simbólicos, cae dentro de alguna raíz y fuera de la carpeta de Claude Code.
 */
export async function resolveInside(
  path: string,
  roots: string[],
  claudeDir: string
): Promise<Resolved> {
  const abs = isAbsolute(path) ? resolve(path) : resolve(roots[0] ?? '.', path)
  const display = displayPath(abs, roots)
  const claudeReal = await realpath(claudeDir).catch(() => resolve(claudeDir))
  const allowed = (p: string): boolean =>
    roots.some((r) => isInside(p, r)) && !isInside(p, claudeReal) && !isInside(p, claudeDir)
  if (!allowed(abs)) return { ok: false, display }
  let real: string
  try {
    real = await realpath(abs)
  } catch {
    return { ok: true, abs, display, exists: false }
  }
  if (!allowed(real)) return { ok: false, display }
  return { ok: true, abs: real, display, exists: true }
}

const SECRET_NAMES = new Set([
  '.credentials.json',
  '.claude.json',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.pgpass',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519'
])
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks'])
const ENV_EXAMPLES = /\.(example|sample|template|dist)$/

/** Archivos que pueden contener secretos: sin vista previa ni diff. */
export function isSecretName(path: string): boolean {
  const name = basename(path).toLowerCase()
  if (SECRET_NAMES.has(name)) return true
  if (name === '.env' || name.startsWith('.env.')) return !ENV_EXAMPLES.test(name)
  return SECRET_EXTENSIONS.has(extname(name))
}

/** Ver `unsafeToOpen` (compartida con el renderer para no ofrecer la acción). */
export function isUnsafeToOpen(
  path: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return unsafeToOpen(path, platform === 'win32')
}
