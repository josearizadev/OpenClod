import { posix, win32 } from 'node:path'

/**
 * Rutas comparables. Las sesiones guardan su `cwd` tal como lo vio
 * Claude Code y el usuario puede escribir o elegir la misma carpeta de otra forma (`c:/x/`,
 * `/c/x` de Git Bash, otras mayúsculas): todas se normalizan antes de compararlas.
 */

/**
 * Forma canónica que se guarda y se muestra. En Windows: `/c/x` → `C:\x`, separadores `\`, sin
 * repetidos (salvo el prefijo UNC), sin barra final salvo en la raíz y letra de unidad en
 * mayúsculas. Conserva las mayúsculas del resto.
 */
export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string {
  const trimmed = p.trim()
  if (trimmed === '') return ''

  if (platform !== 'win32') {
    const normalized = posix.normalize(trimmed)
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
  }

  // Git Bash / MSYS: `/c` o `/c/x` → `C:/` o `C:/x`.
  const gitBash = /^\/([a-zA-Z])(?=\/|$)/.exec(trimmed)
  const native = gitBash ? `${gitBash[1]}:/${trimmed.slice(2)}` : trimmed

  let normalized = win32.normalize(native)
  // `C:` a secas es «la carpeta actual de la unidad C»; aquí se toma como su raíz.
  normalized = normalized.replace(/^([a-zA-Z]):\.?$/, '$1:\\')
  const root = win32.parse(normalized).root
  if (normalized.length > root.length) normalized = normalized.replace(/\\+$/, '')
  return normalized.replace(/^[a-z](?=:)/, (letter) => letter.toUpperCase())
}

/** Clave de comparación: la forma normalizada y, en Windows, en minúsculas. */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalizePath(p, platform)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** `child` es `parent` o está dentro de él (comparando claves). */
export function isInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const childKey = pathKey(child, platform)
  const parentKey = pathKey(parent, platform)
  if (childKey === '' || parentKey === '') return false
  if (childKey === parentKey) return true
  const sep = platform === 'win32' ? '\\' : '/'
  const prefix = parentKey.endsWith(sep) ? parentKey : parentKey + sep
  return childKey.startsWith(prefix)
}
