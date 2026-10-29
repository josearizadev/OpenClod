import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { MENTIONS_MAX, type MentionEntry } from '../../shared/files'
import { runGit, type GitRun } from './git'
import { isInside, pathKey } from './paths'

/**
 * Archivos y carpetas que se sugieren al escribir `@` en el compositor. Solo nombres: nunca se lee
 * el contenido. En un repositorio se respeta `.gitignore` (`git ls-files`); fuera, se recorre la
 * carpeta omitiendo las pesadas. La carpeta de Claude Code no se lista nunca.
 */

export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'vendor'
])

const MAX_FILES = 20_000
const MAX_DEPTH = 12
const CACHE_TTL_MS = 10_000

/** Archivos (relativos a `root`, con `/`) según Git, o `null` si no es un repositorio. */
async function gitFiles(root: string, run: GitRun): Promise<string[] | null> {
  const result = await run(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
  if (!result.ok) return null
  const files = result.stdout.toString('utf8').split('\0').filter(Boolean)
  return [...new Set(files)].slice(0, MAX_FILES)
}

async function walkFiles(root: string, claudeDir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH || isInside(dir, claudeDir)) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(abs, depth + 1)
      } else if (entry.isFile()) {
        files.push(relative(root, abs).replace(/\\/g, '/'))
      }
    }
  }
  await walk(root, 0)
  return files
}

/** Los archivos más las carpetas que los contienen (estas acaban en `/` al insertarlas). */
export function withDirs(files: readonly string[]): MentionEntry[] {
  const dirs = new Set<string>()
  for (const file of files) {
    let cut = file.lastIndexOf('/')
    while (cut > 0) {
      const dir = file.slice(0, cut)
      if (dirs.has(dir)) break
      dirs.add(dir)
      cut = dir.lastIndexOf('/')
    }
  }
  return [
    ...[...dirs].map((path) => ({ path, dir: true })),
    ...files.map((path) => ({ path, dir: false }))
  ]
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (const ch of hay) if (ch === needle[i]) i++
  return i === needle.length
}

/** Menor = mejor; `null` = no coincide. */
function score(entry: MentionEntry, q: string): number | null {
  const path = entry.path.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name.startsWith(q)) return 0
  if (name.includes(q)) return 1
  if (path.startsWith(q)) return 2
  if (path.includes(q)) return 3
  if (isSubsequence(q, path)) return 4
  return null
}

const depth = (path: string): number => path.split('/').length

/**
 * Las `limit` mejores para `query`: primero por cómo coincide (nombre antes que ruta), luego las
 * menos profundas y más cortas. Sin consulta, el primer nivel. Una consulta con `/` se busca en la
 * ruta completa.
 */
export function rankMentions(
  entries: readonly MentionEntry[],
  query: string,
  limit = MENTIONS_MAX
): MentionEntry[] {
  const q = query.toLowerCase().replace(/\\/g, '/')
  const scored: { entry: MentionEntry; rank: number }[] = []
  for (const entry of entries) {
    const rank = q === '' ? (depth(entry.path) === 1 ? 0 : null) : score(entry, q)
    if (rank !== null) scored.push({ entry, rank })
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      depth(a.entry.path) - depth(b.entry.path) ||
      a.entry.path.length - b.entry.path.length ||
      a.entry.path.localeCompare(b.entry.path)
  )
  return scored.slice(0, limit).map((s) => s.entry)
}

export interface FileMentionsOptions {
  claudeDir(): string
  run?: GitRun
  now?: () => number
}

export interface FileMentions {
  /** Sugerencias para `query` en `root` (ya resuelta y comprobada). */
  suggest(root: string, query: string): Promise<MentionEntry[]>
}

export function createFileMentions(options: FileMentionsOptions): FileMentions {
  const run = options.run ?? runGit
  const now = options.now ?? Date.now
  const cache = new Map<string, { entries: Promise<MentionEntry[]>; at: number }>()

  async function load(root: string): Promise<MentionEntry[]> {
    const claudeDir = options.claudeDir()
    const files = (await gitFiles(root, run)) ?? (await walkFiles(root, claudeDir))
    // Git puede listar la carpeta de Claude Code si está dentro del repositorio.
    return withDirs(files.filter((f) => !isInside(join(root, f), claudeDir)))
  }

  function entries(root: string): Promise<MentionEntry[]> {
    const key = pathKey(root)
    const cached = cache.get(key)
    if (cached && now() - cached.at < CACHE_TTL_MS) return cached.entries
    const loading = load(root).catch(() => [])
    cache.set(key, { entries: loading, at: now() })
    return loading
  }

  return {
    async suggest(root, query) {
      return rankMentions(await entries(root), query)
    }
  }
}
