import type Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { SessionMoveResult } from '../../shared/projects'
import { isInside, pathKey } from './paths'
import { sessionPaths } from './session-trash'

/**
 * Mover conversaciones a otro proyecto: junto con «Eliminar», la única escritura de la app en la
 * carpeta de Claude Code. Claude Code busca una sesión en `projects/<carpeta del cwd>/` al
 * reanudarla, así que de cada sesión de la cadena se mueven su `.jsonl` y su carpeta `<id>/` a la
 * carpeta del destino, sin tocar su contenido. La reasignación (para el índice) la guarda quien llama.
 */

export interface MoveDeps {
  reader: Database.Database
  /** `projects/` de la carpeta de Claude Code: ninguna ruta fuera de ella se toca. */
  projectsDir: string
  chatState(sessionId: string): 'active' | 'idle' | null
  closeChat(sessionId: string): Promise<void>
  log?: { warn(scope: string, message: string): void }
  /** Para tests: `rename` de `node:fs/promises`. */
  rename?: (from: string, to: string) => Promise<void>
}

export interface MoveOutcome extends SessionMoveResult {
  /** Ids de todas las sesiones movidas (cadenas enteras), para guardar la reasignación. */
  sessions: string[]
}

/** Límite de Claude Code para el nombre de la carpeta sin acortar (con hash). */
const MAX_FOLDER = 200

/** Carpeta de `projects/` que Claude Code usa para `cwd`: todo lo que no es letra o número, `-`. */
export function claudeFolderName(cwd: string): string | null {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return name.length <= MAX_FOLDER ? name : null
}

/** Carpeta de destino: la que ya usan las sesiones del proyecto o, si no hay, la calculada. */
function destinationFolder(reader: Database.Database, cwd: string): string | null {
  const used = reader
    .prepare<[string], string>(
      `SELECT folder FROM sessions WHERE project_key = ?
       GROUP BY folder ORDER BY count(*) DESC, folder LIMIT 1`
    )
    .pluck()
    .get(pathKey(cwd))
  return used ?? claudeFolderName(cwd)
}

interface ChainRow {
  session_id: string
  file: string
}

export async function moveSessions(
  sessionIds: readonly string[],
  cwd: string,
  deps: MoveDeps
): Promise<MoveOutcome> {
  const move = deps.rename ?? rename
  const conversationOf = deps.reader
    .prepare<[string], string>('SELECT conversation_id FROM sessions WHERE session_id = ?')
    .pluck()
  const chainOf = deps.reader.prepare<[string], ChainRow>(
    'SELECT session_id, file FROM sessions WHERE conversation_id = ?'
  )
  const outcome: MoveOutcome = { moved: [], skipped: [], sessions: [] }

  const folder = destinationFolder(deps.reader, cwd)
  const target: string = folder ? join(deps.projectsDir, folder) : ''
  if (!folder || !isInside(target, deps.projectsDir) || basename(target) !== folder) {
    for (const sessionId of new Set(sessionIds)) {
      outcome.skipped.push({ sessionId, reason: 'failed' })
    }
    return outcome
  }

  const byConversation = new Map<string, string[]>()
  for (const id of new Set(sessionIds)) {
    const conversation = conversationOf.get(id)
    if (!conversation) {
      outcome.skipped.push({ sessionId: id, reason: 'not-found' })
      continue
    }
    byConversation.set(conversation, [...(byConversation.get(conversation) ?? []), id])
  }

  for (const [conversation, ids] of byConversation) {
    const chain = chainOf.all(conversation)
    const skip = (reason: SessionMoveResult['skipped'][number]['reason']): void => {
      for (const sessionId of ids) outcome.skipped.push({ sessionId, reason })
    }
    if (chain.some((row) => deps.chatState(row.session_id) === 'active')) {
      skip('active')
      continue
    }
    const paths: string[] = []
    let valid = true
    for (const row of chain) {
      const found = sessionPaths(row, deps.projectsDir)
      if (!found) valid = false
      else paths.push(...found)
    }
    if (!valid) {
      skip('failed')
      continue
    }
    if (paths.length === 0) {
      skip('not-found')
      continue
    }
    // Lo que ya está en el destino no se mueve; si todo lo está, no hay nada que hacer.
    const renames: { from: string; to: string }[] = paths
      .filter((path) => pathKey(dirname(path)) !== pathKey(target))
      .map((from) => ({ from, to: join(target, basename(from)) }))
    if (renames.some(({ to }) => existsSync(to))) {
      skip('conflict')
      continue
    }
    for (const row of chain) {
      if (deps.chatState(row.session_id) === 'idle') await deps.closeChat(row.session_id)
    }
    const done: typeof renames = []
    try {
      if (renames.length > 0) await mkdir(target, { recursive: true })
      for (const step of renames) {
        await move(step.from, step.to)
        done.push(step)
      }
    } catch (error) {
      deps.log?.warn('sessions', `No se pudo mover ${conversation}: ${String(error)}`)
      // Se deshace lo movido de esta conversación para no dejarla partida.
      for (const step of done.reverse()) await move(step.to, step.from).catch(() => undefined)
      skip('failed')
      continue
    }
    outcome.moved.push(...ids)
    outcome.sessions.push(...chain.map((row) => row.session_id))
  }
  return outcome
}
