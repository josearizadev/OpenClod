import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { ClaudeDirSource } from '../../shared/sessions'
import { logger as defaultLogger, type Logger } from './logger'
import { t } from '../i18n'

/**
 * Ubicación de los datos de Claude Code. Solo `readdir` y `stat`: este
 * módulo nunca abre nada para escribir dentro de la carpeta de Claude Code ni lee
 * credenciales.
 */

export interface ResolvedClaudeDir {
  dir: string
  source: ClaudeDirSource
}

/** Ajustes → `CLAUDE_CONFIG_DIR` → `~/.claude`. Un valor vacío cuenta como no definido. */
export function resolveClaudeDir(opts: {
  configured: string | null | undefined
  env: NodeJS.ProcessEnv
  home: string
}): ResolvedClaudeDir {
  const configured = opts.configured?.trim()
  if (configured) return { dir: resolve(configured), source: 'settings' }
  const fromEnv = opts.env['CLAUDE_CONFIG_DIR']?.trim()
  if (fromEnv) return { dir: resolve(fromEnv), source: 'env' }
  return { dir: join(opts.home, '.claude'), source: 'default' }
}

export interface SubagentFileRef {
  agentId: string
  file: string
  /** `agent-<id>.meta.json`, si existe. */
  metaFile?: string
}

export interface SessionFileRef {
  sessionId: string
  file: string
  size: number
  mtimeMs: number
  subagents: SubagentFileRef[]
}

export interface ProjectDir {
  /** Nombre codificado de la carpeta (ambiguo: la ruta real sale del `cwd` de las sesiones). */
  name: string
  dir: string
  sessions: SessionFileRef[]
}

export type ListProjectsResult =
  | { ok: true; projectsDir: string; projects: ProjectDir[] }
  | { ok: false; projectsDir: string; reason: string }

const SUBAGENT_FILE = /^agent-(.+)\.jsonl$/

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

export async function listSubagents(sessionDir: string): Promise<SubagentFileRef[]> {
  const dir = join(sessionDir, 'subagents')
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch {
    // Lo normal: la sesión no lanzó subagentes y la carpeta no existe.
    return []
  }
  const present = new Set(names)
  return names
    .map((name) => SUBAGENT_FILE.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const agentId = match[1] as string
      const meta = `agent-${agentId}.meta.json`
      const ref: SubagentFileRef = { agentId, file: join(dir, match[0]) }
      if (present.has(meta)) ref.metaFile = join(dir, meta)
      return ref
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId))
}

async function listSessions(projectDir: string): Promise<SessionFileRef[]> {
  const entries = await readdir(projectDir, { withFileTypes: true })
  const sessions: SessionFileRef[] = []
  for (const entry of entries) {
    // Solo los `.jsonl` de primer nivel son sesiones: `memory/`, `tool-results/`… se ignoran.
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const file = join(projectDir, entry.name)
    const sessionId = entry.name.slice(0, -'.jsonl'.length)
    try {
      const info = await stat(file)
      sessions.push({
        sessionId,
        file,
        size: info.size,
        mtimeMs: info.mtimeMs,
        subagents: await listSubagents(join(projectDir, sessionId))
      })
    } catch {
      // Borrada entre `readdir` y `stat`: ya no existe.
    }
  }
  return sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
}

/** Proyectos de `<base>/projects` con sus sesiones y subagentes. Nunca lanza. */
export async function listProjects(
  baseDir: string,
  log: Pick<Logger, 'warn'> = defaultLogger
): Promise<ListProjectsResult> {
  const projectsDir = join(baseDir, 'projects')
  let entries
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch (error) {
    const reason =
      errorCode(error) === 'ENOENT'
        ? t('No existe la carpeta {dir}', { dir: projectsDir })
        : t('No se puede leer la carpeta {dir}', { dir: projectsDir })
    return { ok: false, projectsDir, reason }
  }
  const projects: ProjectDir[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(projectsDir, entry.name)
    try {
      projects.push({ name: entry.name, dir, sessions: await listSessions(dir) })
    } catch (error) {
      log.warn('claude-paths', `Se omite el proyecto ${entry.name}: ${String(error)}`)
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: true, projectsDir, projects }
}

/**
 * `SessionFileRef` de un `.jsonl` principal ya conocido: el visor lo
 * localiza por el índice y aquí solo se hace `stat` y se listan sus subagentes. Lanza si el
 * archivo no existe.
 */
export async function sessionRefFromFile(file: string): Promise<SessionFileRef> {
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`No es un archivo: ${file}`)
  const sessionId = basename(file, '.jsonl')
  return {
    sessionId,
    file,
    size: info.size,
    mtimeMs: info.mtimeMs,
    subagents: await listSubagents(join(file, '..', sessionId))
  }
}
