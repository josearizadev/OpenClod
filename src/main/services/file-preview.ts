import { open, stat } from 'node:fs/promises'
import { basename, extname, relative } from 'node:path'
import {
  IMAGE_PREVIEW_MAX,
  TEXT_PREVIEW_MAX,
  type FileDiff,
  type FilePreview
} from '../../shared/files'
import { isSecretName } from './file-access'
import type { GitService } from './git'

/**
 * Vista previa del contenido actual en disco y diff contra `HEAD`. Lecturas acotadas: nunca se
 * carga entero un archivo grande.
 */

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
}

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

/** Extensión → lenguaje que entiende `resolveLanguage` del renderer (o sus alias). */
const LANG_ALIASES: Record<string, string> = {
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  htm: 'html',
  cts: 'ts',
  jsonl: 'json',
  vbs: 'text',
  lock: 'text',
  txt: 'text',
  log: 'text'
}

const NAMED: Record<string, string> = {
  dockerfile: 'bash',
  makefile: 'bash',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini'
}

export function langOf(path: string): string {
  const name = basename(path).toLowerCase()
  if (NAMED[name]) return NAMED[name]
  const ext = extname(name).slice(1)
  if (!ext) return 'text'
  return LANG_ALIASES[ext] ?? ext
}

function imageMime(path: string): string | null {
  return IMAGE_MIME[extname(path).toLowerCase()] ?? null
}

/** Lee como mucho `max` bytes del principio. */
async function readHead(path: string, max: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(max)
    const { bytesRead } = await handle.read(buffer, 0, max, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** NUL en los primeros 8 kB = binario. */
function looksBinary(data: Buffer): boolean {
  return data.subarray(0, 8192).includes(0)
}

/** UTF-8 sin BOM y sin el último carácter si quedó partido al recortar. */
function decode(data: Buffer, truncated: boolean): string {
  let text = data.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (truncated) text = text.replace(/�$/, '')
  return text
}

export async function readPreview(abs: string, display: string): Promise<FilePreview> {
  if (isSecretName(abs)) return { kind: 'secret', path: display }
  let info
  try {
    info = await stat(abs)
  } catch {
    return { kind: 'missing', path: display }
  }
  if (!info.isFile()) return { kind: 'binary', path: display, size: info.size }

  const mime = imageMime(abs)
  if (mime) {
    if (info.size > IMAGE_PREVIEW_MAX) return { kind: 'too-large', path: display, size: info.size }
    const data = await readHead(abs, info.size)
    return {
      kind: 'image',
      path: display,
      dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      size: info.size,
      mtimeMs: info.mtimeMs
    }
  }

  const truncated = info.size > TEXT_PREVIEW_MAX
  const data = await readHead(abs, Math.min(info.size, TEXT_PREVIEW_MAX))
  if (looksBinary(data)) return { kind: 'binary', path: display, size: info.size }
  return {
    kind: MARKDOWN.has(extname(abs).toLowerCase()) ? 'markdown' : 'text',
    path: display,
    text: decode(data, truncated),
    lang: langOf(abs),
    size: info.size,
    truncated,
    mtimeMs: info.mtimeMs
  }
}

/** Contenido actual: `null` si no existe; `'binary'`/`'too-large'` si no se puede comparar. */
async function current(abs: string): Promise<string | null | 'binary' | 'too-large'> {
  let info
  try {
    info = await stat(abs)
  } catch {
    return null
  }
  if (!info.isFile()) return 'binary'
  if (info.size > TEXT_PREVIEW_MAX) return 'too-large'
  const data = await readHead(abs, info.size)
  return looksBinary(data) ? 'binary' : decode(data, false)
}

export async function readDiff(
  abs: string,
  display: string,
  git: Pick<GitService, 'toplevel' | 'blobAtHead'>,
  dir: string
): Promise<FileDiff> {
  if (isSecretName(abs)) return { kind: 'secret', path: display }
  const top = await git.toplevel(dir)
  if (!top) return { kind: 'not-repo', path: display }
  const rel = relative(top, abs).replace(/\\/g, '/')
  if (rel.startsWith('..')) return { kind: 'outside', path: display }

  const [blob, after] = await Promise.all([
    git.blobAtHead(top, rel, TEXT_PREVIEW_MAX),
    current(abs)
  ])
  if (!blob) return { kind: 'not-repo', path: display }
  if (blob.kind === 'too-large' || after === 'too-large')
    return { kind: 'too-large', path: display }
  if (after === 'binary' || (blob.kind === 'ok' && looksBinary(blob.data))) {
    return { kind: 'binary', path: display }
  }
  // Con `core.autocrlf` el blob tiene LF y la copia de trabajo CRLF: se comparan sin `\r`.
  const lf = (text: string | null): string | null => text?.replace(/\r\n/g, '\n') ?? null
  const before = lf(blob.kind === 'ok' ? decode(blob.data, false) : null)
  if (before === lf(after)) return { kind: 'unchanged', path: display }
  return { kind: 'text', path: display, before, after: lf(after) }
}
