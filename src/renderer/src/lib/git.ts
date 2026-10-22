import type { GitChangeKind, GitFileChange } from '../../../shared/git'

/** Presentación de los cambios de Git. Puro. */

const LETTERS: Record<GitChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflict: '!'
}

const LABELS: Record<GitChangeKind, string> = {
  modified: 'Modificado',
  added: 'Añadido',
  deleted: 'Borrado',
  renamed: 'Renombrado',
  copied: 'Copiado',
  typechange: 'Cambio de tipo',
  untracked: 'Sin seguimiento',
  conflict: 'En conflicto'
}

export function gitChangeLetter(kind: GitChangeKind): string {
  return LETTERS[kind]
}

export function gitChangeLabel(change: GitFileChange): string {
  const base = LABELS[change.kind]
  const from = change.origPath ? ` desde ${change.origPath}` : ''
  return change.staged && !change.unstaged ? `${base}${from} (preparado)` : `${base}${from}`
}

export function gitChangeTone(kind: GitChangeKind): string {
  if (kind === 'added' || kind === 'untracked') return 'text-diff-add'
  if (kind === 'deleted') return 'text-diff-del'
  if (kind === 'conflict') return 'text-danger'
  return 'text-warning'
}

/** Clave para comparar rutas de Git y de la sesión (separadores `/`, minúsculas en Windows). */
export function fileKey(path: string, windows: boolean): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+/g, '/')
  return windows ? slashed.toLowerCase() : slashed
}

/** Ruta absoluta de un cambio de Git. */
export function gitAbsolute(root: string, path: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${path}`
}
