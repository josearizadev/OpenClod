import { createHash } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_MD_MAX, type ClaudeMdFile, type ClaudeMdWrite } from '../../shared/files'
import { isInside } from './paths'

/**
 * `CLAUDE.md` del proyecto. Solo la raíz del proyecto (o su
 * `.claude/CLAUDE.md`); nunca dentro de la carpeta de Claude Code. Se escribe de forma atómica y
 * solo si nadie lo cambió desde que se leyó.
 */

export class ClaudeMdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeMdError'
  }
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** `<raíz>/CLAUDE.md`, o `<raíz>/.claude/CLAUDE.md` si solo existe ese. */
async function claudeMdPath(root: string, claudeDir: string): Promise<string> {
  const main = join(root, 'CLAUDE.md')
  const nested = join(root, '.claude', 'CLAUDE.md')
  const path = !(await exists(main)) && (await exists(nested)) ? nested : main
  if (isInside(path, claudeDir)) {
    throw new ClaudeMdError(
      'Ese CLAUDE.md está en la carpeta de Claude Code: no se edita desde aquí.'
    )
  }
  return path
}

export async function readClaudeMd(root: string, claudeDir: string): Promise<ClaudeMdFile> {
  const path = await claudeMdPath(root, claudeDir)
  let info
  try {
    info = await stat(path)
  } catch {
    return { path, exists: false, text: '', hash: null, mtimeMs: null }
  }
  if (info.size > CLAUDE_MD_MAX) throw new ClaudeMdError('CLAUDE.md es demasiado grande (> 1 MB).')
  const text = await readFile(path, 'utf8')
  return { path, exists: true, text, hash: hashText(text), mtimeMs: info.mtimeMs }
}

export async function writeClaudeMd(
  root: string,
  claudeDir: string,
  text: string,
  expectedHash: string | null
): Promise<ClaudeMdWrite> {
  if (Buffer.byteLength(text, 'utf8') > CLAUDE_MD_MAX) {
    throw new ClaudeMdError('CLAUDE.md es demasiado grande (> 1 MB).')
  }
  const current = await readClaudeMd(root, claudeDir)
  if (current.hash !== expectedHash) return { ok: false, reason: 'conflict', file: current }

  const tmp = `${current.path}.bitacora-${process.pid}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, current.path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
  return { ok: true, file: await readClaudeMd(root, claudeDir) }
}
