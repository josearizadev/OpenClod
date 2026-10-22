import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import {
  GIT_MAX_FILES,
  type GitChangeKind,
  type GitFileChange,
  type GitInfo,
  type GitStatus,
  type GitWorktree
} from '../../shared/git'
import type { Logger } from './logger'
import { normalizePath, pathKey } from './paths'

/**
 * Git de solo lectura: la CLI con `execFile` (sin shell), sin tomar
 * bloqueos del repositorio y con 5 s de tiempo límite.
 */

export type GitRunResult =
  | { ok: true; stdout: Buffer }
  | { ok: false; /** Git no está instalado. */ missing: boolean; message: string }

export type GitRun = (args: string[], cwd: string) => Promise<GitRunResult>

const TIMEOUT_MS = 5000

const runGit: GitRun = (args, cwd) =>
  new Promise((done) => {
    execFile(
      'git',
      ['--no-optional-locks', '-c', 'core.quotepath=false', ...args],
      {
        cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        encoding: 'buffer',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C'
        }
      },
      (error, stdout, stderr) => {
        if (!error) return done({ ok: true, stdout })
        const code = (error as NodeJS.ErrnoException).code
        done({
          ok: false,
          missing: code === 'ENOENT',
          message: stderr.toString('utf8').trim() || error.message
        })
      }
    )
  })

// --- Parsers (puros y tolerantes) -------------------------------------------------------------

function kindOf(xy: string): GitChangeKind {
  const [x = '.', y = '.'] = xy
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'A') return 'added'
  if (x === 'T' || y === 'T') return 'typechange'
  return 'modified'
}

function change(xy: string, path: string, kind: GitChangeKind, origPath?: string): GitFileChange {
  return {
    path,
    ...(origPath ? { origPath } : {}),
    kind,
    staged: xy[0] !== '.' && xy[0] !== '?',
    unstaged: xy[1] !== '.'
  }
}

/** `git status --porcelain=v2 --branch -z`: registros separados por NUL. */
export function parseStatus(text: string, root: string): GitStatus {
  const status: GitStatus = {
    root,
    branch: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    truncated: false
  }
  const records = text.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ''
    if (record === '') continue
    if (record.startsWith('# ')) {
      const [, key = '', ...rest] = record.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.head = value === '(initial)' ? null : value.slice(0, 7)
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const ab = /^\+(\d+) -(\d+)$/.exec(value)
        if (ab) {
          status.ahead = Number(ab[1])
          status.behind = Number(ab[2])
        }
      }
      continue
    }
    let match: RegExpExecArray | null
    if ((match = /^1 (\S\S) (?:\S+ ){6}(.+)$/s.exec(record))) {
      status.files.push(change(match[1]!, match[2]!, kindOf(match[1]!)))
    } else if ((match = /^2 (\S\S) (?:\S+ ){7}(.+)$/s.exec(record))) {
      const xy = match[1]!
      const orig = records[++i]
      const kind: GitChangeKind = xy.includes('C') ? 'copied' : 'renamed'
      status.files.push(change(xy, match[2]!, kind, orig || undefined))
    } else if ((match = /^u (\S\S) (?:\S+ ){8}(.+)$/s.exec(record))) {
      status.files.push({ path: match[2]!, kind: 'conflict', staged: false, unstaged: true })
    } else if (record.startsWith('? ')) {
      status.files.push({ path: record.slice(2), kind: 'untracked', staged: false, unstaged: true })
    }
    // `!` (ignorados) y lo desconocido se ignoran.
  }
  status.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  if (status.files.length > GIT_MAX_FILES) {
    status.files = status.files.slice(0, GIT_MAX_FILES)
    status.truncated = true
  }
  return status
}

/** `git worktree list --porcelain`: bloques separados por una línea vacía. */
export function parseWorktrees(text: string): Omit<GitWorktree, 'current' | 'projectId'>[] {
  const out: Omit<GitWorktree, 'current' | 'projectId'>[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    let path: string | null = null
    let head: string | null = null
    let branch: string | null = null
    let detached = false
    let bare = false
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) path = line.slice(9)
      else if (line.startsWith('HEAD ')) head = line.slice(5, 12)
      else if (line.startsWith('branch ')) branch = line.slice(7).replace(/^refs\/heads\//, '')
      else if (line === 'detached') detached = true
      else if (line === 'bare') bare = true
    }
    if (path) out.push({ path: normalizePath(path), head, branch, detached, bare })
  }
  return out
}

// --- Servicio -----------------------------------------------------------------------------------

export type BlobAtHead =
  { kind: 'ok'; data: Buffer } | { kind: 'missing' } | { kind: 'too-large'; size: number }

export interface GitService {
  /** `null` = no es un repositorio o Git no está instalado. */
  info(dir: string, opts?: { fresh?: boolean }): Promise<GitInfo | null>
  /** Raíz del repositorio que contiene `dir`, o `null`. */
  toplevel(dir: string): Promise<string | null>
  /** Contenido de `rel` (relativa a `top`, con `/`) en `HEAD`, acotado a `max` bytes. */
  blobAtHead(top: string, rel: string, max: number): Promise<BlobAtHead | null>
  /** Versión de Git, o `null` si no está instalado. */
  version(): Promise<string | null>
}

export interface GitServiceOptions {
  run?: GitRun
  /** Proyectos importados, para marcar los worktrees que ya lo son. */
  projects?: () => { id: string; path: string }[]
  now?: () => number
  log?: Pick<Logger, 'warn'>
}

const INFO_TTL_MS = 1000
const TOPLEVEL_TTL_MS = 10_000

export function createGitService(options: GitServiceOptions = {}): GitService {
  const run = options.run ?? runGit
  const now = options.now ?? Date.now
  const tops = new Map<string, { top: string | null; at: number }>()
  const infos = new Map<string, { info: GitInfo; at: number }>()
  const inflight = new Map<string, Promise<GitInfo | null>>()
  let versionPromise: Promise<string | null> | null = null

  async function toplevel(dir: string): Promise<string | null> {
    const key = pathKey(dir)
    const cached = tops.get(key)
    if (cached && now() - cached.at < TOPLEVEL_TTL_MS) return cached.top
    const result = await run(['rev-parse', '--show-toplevel'], dir)
    const top = result.ok ? normalizePath(resolve(result.stdout.toString('utf8').trim())) : null
    if (!result.ok && result.missing) options.log?.warn('git', 'Git no está instalado')
    tops.set(key, { top, at: now() })
    return top
  }

  async function load(top: string): Promise<GitInfo | null> {
    const [status, worktrees] = await Promise.all([
      run(['status', '--porcelain=v2', '--branch', '-z', '-uall'], top),
      run(['worktree', 'list', '--porcelain'], top)
    ])
    if (!status.ok) {
      options.log?.warn('git', `git status falló: ${status.message}`)
      return null
    }
    const projects = options.projects?.() ?? []
    const list = worktrees.ok ? parseWorktrees(worktrees.stdout.toString('utf8')) : []
    return {
      status: parseStatus(status.stdout.toString('utf8'), top),
      worktrees: list.map((w) => ({
        ...w,
        current: pathKey(w.path) === pathKey(top),
        projectId: projects.find((p) => pathKey(p.path) === pathKey(w.path))?.id ?? null
      }))
    }
  }

  return {
    toplevel,

    async info(dir, opts = {}) {
      const top = await toplevel(dir)
      if (!top) return null
      const key = pathKey(top)
      const cached = infos.get(key)
      if (!opts.fresh && cached && now() - cached.at < INFO_TTL_MS) return cached.info
      const pending = inflight.get(key)
      if (pending) return pending
      const promise = load(top)
        .then((info) => {
          if (info) infos.set(key, { info, at: now() })
          else infos.delete(key)
          return info
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, promise)
      return promise
    },

    async blobAtHead(top, rel, max) {
      const spec = `HEAD:${rel}`
      const size = await run(['cat-file', '-s', spec], top)
      if (!size.ok) return size.missing ? null : { kind: 'missing' }
      const bytes = Number(size.stdout.toString('utf8').trim())
      if (!Number.isFinite(bytes)) return { kind: 'missing' }
      if (bytes > max) return { kind: 'too-large', size: bytes }
      const blob = await run(['cat-file', 'blob', spec], top)
      return blob.ok ? { kind: 'ok', data: blob.stdout } : { kind: 'missing' }
    },

    version() {
      versionPromise ??= run(['--version'], process.cwd()).then((r) =>
        r.ok
          ? r.stdout
              .toString('utf8')
              .trim()
              .replace(/^git version\s*/, '')
          : null
      )
      return versionPromise
    }
  }
}
