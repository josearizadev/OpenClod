import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

/**
 * Cómo se lanza Claude Code. Cada sesión de chat es un proceso de Claude
 * Code que usa la sesión ya iniciada del usuario: la app no lee ni guarda credenciales.
 */

export type CwdCheck = { ok: true; path: string } | { ok: false; reason: 'missing' | 'claude-dir' }

/**
 * Comprueba la carpeta de trabajo: ruta absoluta, existente, que sea un directorio y que no esté
 * dentro de la carpeta de Claude Code (la de los ajustes). Devuelve la ruta real.
 */
export async function checkCwd(cwd: string, claudeDir: string): Promise<CwdCheck> {
  if (!isAbsolute(cwd)) return { ok: false, reason: 'missing' }
  let real: string
  try {
    if (!(await stat(cwd)).isDirectory()) return { ok: false, reason: 'missing' }
    real = await realpath(cwd)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  const claudeReal = await realpath(claudeDir).catch(() => claudeDir)
  const rel = relative(claudeReal, real)
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  return inside ? { ok: false, reason: 'claude-dir' } : { ok: true, path: real }
}

export function cwdErrorMessage(reason: 'missing' | 'claude-dir'): string {
  return reason === 'claude-dir'
    ? 'No se puede trabajar dentro de la carpeta de Claude Code.'
    : 'La carpeta de trabajo no existe o no es una carpeta.'
}

/**
 * Ruta del binario de Claude Code que trae el SDK como dependencia opcional por plataforma.
 * Empaquetada, `require.resolve` apunta dentro de `app.asar`, desde donde no se puede ejecutar:
 * se cambia por `app.asar.unpacked`. `undefined` → el SDK la busca por su cuenta.
 */
export function resolveClaudeExecutable(
  resolve: (id: string) => string = require.resolve,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | undefined {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  try {
    const path = resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/${exe}`)
    return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
  } catch {
    return undefined
  }
}

export interface RuntimeConfig {
  /** Ruta explícita del binario (ver `resolveClaudeExecutable`). */
  claudePath?: string
  /** Carpeta de Claude Code que usa la app (ajustes → `CLAUDE_CONFIG_DIR` → `~/.claude`). */
  claudeDir: string
  /** `true` si el usuario eligió otra carpeta en Ajustes: se pasa como `CLAUDE_CONFIG_DIR`. */
  customClaudeDir: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * Opciones comunes de `query()`. Se cargan todos los ajustes como en la terminal: reglas,
 * `CLAUDE.md`, MCP y hooks. Sin restricciones de solo lectura.
 */
export function baseOptions(config: RuntimeConfig): Options {
  return {
    ...(config.claudePath ? { pathToClaudeCodeExecutable: config.claudePath } : {}),
    includePartialMessages: true,
    settingSources: ['user', 'project', 'local'],
    ...(config.customClaudeDir
      ? { env: { ...(config.env ?? process.env), CLAUDE_CONFIG_DIR: config.claudeDir } }
      : {})
  }
}
