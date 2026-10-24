/** Utilidades del panel de archivos. Puro. */
import { tag } from '../i18n'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toLocaleString(tag, { maximumFractionDigits: kb < 10 ? 1 : 0 })} kB`
  const mb = kb / 1024
  return `${mb.toLocaleString(tag, { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`
}

/** ¿Es una ruta absoluta (Windows o POSIX)? */
function isAbsolutePath(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(path)
}

/** Une la carpeta de la sesión con una ruta relativa (o devuelve la absoluta). */
export function joinPath(dir: string | undefined, path: string): string {
  if (!dir || isAbsolutePath(path)) return path
  return `${dir.replace(/[\\/]+$/, '')}/${path}`
}

/** La carpeta es de Windows (letra de unidad o UNC). */
export function isWindowsPath(path: string | undefined): boolean {
  return !!path && /^(?:[a-zA-Z]:|\\\\)/.test(path)
}
