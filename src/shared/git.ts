/**
 * Estado de Git de la carpeta de una sesión o proyecto. Solo lectura:
 * la app nunca escribe en el repositorio.
 */

export type GitChangeKind =
  'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'conflict'

export interface GitFileChange {
  /** Relativa a la raíz del repositorio, con `/`. */
  path: string
  /** Ruta anterior de un renombrado o copia. */
  origPath?: string
  kind: GitChangeKind
  /** Hay cambios en el índice (preparados). */
  staged: boolean
  /** Hay cambios en el árbol de trabajo sin preparar. */
  unstaged: boolean
}

export interface GitStatus {
  /** Raíz del repositorio (absoluta). */
  root: string
  /** `null` = HEAD separado. */
  branch: string | null
  /** Oid corto; `null` = repositorio sin commits. */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Ordenados por ruta; como mucho `GIT_MAX_FILES`. */
  files: GitFileChange[]
  truncated: boolean
}

export interface GitWorktree {
  path: string
  branch: string | null
  head: string | null
  /** Es el de la carpeta consultada. */
  current: boolean
  detached: boolean
  bare: boolean
  /** Proyecto importado con esa carpeta, si lo hay. */
  projectId: string | null
}

export interface GitInfo {
  status: GitStatus
  worktrees: GitWorktree[]
}

export const GIT_MAX_FILES = 2000
