import type Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SessionTrashResult } from '../../shared/projects'
import { isInside } from './paths'

/**
 * Eliminar conversaciones: la única escritura de la app en
 * la carpeta de Claude Code. Cada entrada de la lista arrastra su conversación entera (todas las
 * sesiones de la cadena); de cada sesión se mueven a la papelera su `.jsonl` y su carpeta hermana
 * `<id>/` (subagentes y resultados), y nada más.
 */

export interface TrashDeps {
  reader: Database.Database
  /** `projects/` de la carpeta de Claude Code: ninguna ruta fuera de ella se toca. */
  projectsDir: string
  /** Estado del chat de la app en esa sesión. */
  chatState(sessionId: string): 'active' | 'idle' | null
  closeChat(sessionId: string): Promise<void>
  trash(path: string): Promise<void>
}

export interface TrashOutcome extends SessionTrashResult {
  /** Conversaciones movidas, para borrar sus datos propios. */
  conversations: string[]
}

interface ChainRow {
  session_id: string
  file: string
}

/** Archivo y carpeta de la sesión que se pueden mover, o `null` si la ruta no es la esperada. */
export function sessionPaths(row: ChainRow, projectsDir: string): string[] | null {
  if (!isInside(row.file, projectsDir) || basename(row.file) !== `${row.session_id}.jsonl`)
    return null
  const paths = existsSync(row.file) ? [row.file] : []
  const folder = join(dirname(row.file), row.session_id)
  try {
    if (statSync(folder).isDirectory()) paths.push(folder)
  } catch {
    // Sin subagentes ni resultados.
  }
  return paths
}

export async function trashSessions(
  sessionIds: readonly string[],
  deps: TrashDeps
): Promise<TrashOutcome> {
  const conversationOf = deps.reader
    .prepare<[string], string>('SELECT conversation_id FROM sessions WHERE session_id = ?')
    .pluck()
  const chainOf = deps.reader.prepare<[string], ChainRow>(
    'SELECT session_id, file FROM sessions WHERE conversation_id = ?'
  )

  const outcome: TrashOutcome = { trashed: [], skipped: [], conversations: [] }
  // Varias entradas de la misma conversación se mueven una sola vez.
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
    const skip = (reason: 'active' | 'failed' | 'not-found'): void => {
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
    for (const row of chain) {
      if (deps.chatState(row.session_id) === 'idle') await deps.closeChat(row.session_id)
    }
    let failed = false
    for (const path of paths) {
      try {
        await deps.trash(path)
      } catch {
        failed = true
      }
    }
    if (failed) {
      skip('failed')
      continue
    }
    outcome.trashed.push(...ids)
    outcome.conversations.push(conversation)
  }
  return outcome
}
