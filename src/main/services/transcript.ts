import type Database from 'better-sqlite3'
import type {
  SubagentTranscript,
  TranscriptItem,
  TranscriptPayload,
  TranscriptSegment
} from '../../shared/sessions'
import { sessionRefFromFile, type SessionFileRef } from './claude-paths'
import { orderChain } from './index-queries'
import { logger as defaultLogger, type Logger } from './logger'
import { isInside } from './paths'
import { loadSession, loadSubagent } from './session-loader'
import type { TranscriptFollower } from './transcript-follower'
import { t } from '../i18n'

/**
 * Transcript de una sesión para el visor. El archivo se localiza **a partir
 * del índice** (el renderer solo manda el id) y se lee en cada apertura: ni el índice ni
 * `state.json` guardan contenido. Solo lectura de la carpeta de Claude Code.
 */

/** Error de E/S al leer una sesión que sí existe; la capa IPC lo traduce a `INTERNAL`. */
export class TranscriptReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptReadError'
  }
}

export interface TranscriptServiceOptions {
  reader: Database.Database | null
  claudeDir: () => string
  /** Seguimiento en vivo de la sesión leída. */
  follower?: TranscriptFollower
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface TranscriptService {
  /** `follow` = destinatario (id de `webContents`) que pasa a seguir esta sesión. */
  transcript(sessionId: string, follow?: number): Promise<TranscriptPayload | null>
  subagent(sessionId: string, agentId: string): Promise<SubagentTranscript | null>
  /**
   * Qué reanudar al escribir en una sesión: la **última** de su conversación (la
   * que reanudaría `claude --resume`), su carpeta y el último modelo del hilo principal.
   */
  resumeTarget(sessionId: string): ResumeTarget | null
}

export interface ResumeTarget {
  sessionId: string
  cwd: string
  model?: string
}

interface LocatedRow {
  file: string
  conversation_id: string
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

/**
 * Asigna cada elemento a la primera sesión de la cadena que lo contiene (por `uuid`) y marca lo
 * heredado. `previous` son los `uuid` de las sesiones anteriores, en orden de la cadena.
 */
export function segmentsOf(
  sessionId: string,
  items: TranscriptItem[],
  previous: { sessionId: string; uuids: ReadonlySet<string> }[]
): { items: TranscriptItem[]; segments: TranscriptSegment[] } {
  const own = previous.length
  if (own === 0) {
    const first = items[0]
    return {
      items,
      segments: [
        {
          sessionId,
          firstLine: first?.line ?? 1,
          ...(firstTimestamp(items, 0) ? { startedAt: firstTimestamp(items, 0) } : {})
        }
      ]
    }
  }

  const ids = [...previous.map((p) => p.sessionId), sessionId]
  const firstIndex: (number | undefined)[] = ids.map(() => undefined)
  // Los orígenes van en orden: la continuación copia las líneas al principio. Un elemento sin
  // `uuid` hereda el origen del anterior (no puede retroceder).
  let current = 0
  const out = items.map((item, index) => {
    let origin = current
    if (item.uuid) {
      const found = previous.findIndex((p) => p.uuids.has(item.uuid as string))
      origin = found === -1 ? own : Math.max(found, current)
    }
    current = origin
    if (firstIndex[origin] === undefined) firstIndex[origin] = index
    if (origin < own && !item.inherited) return { ...item, inherited: true as const }
    return item
  })

  const segments: TranscriptSegment[] = []
  ids.forEach((id, origin) => {
    const index = firstIndex[origin]
    if (index === undefined) return
    const startedAt = firstTimestamp(out, index)
    segments.push({
      sessionId: id,
      firstLine: (out[index] as TranscriptItem).line,
      ...(startedAt ? { startedAt } : {})
    })
  })
  return { items: out, segments }
}

function firstTimestamp(items: TranscriptItem[], from: number): string | undefined {
  for (let i = from; i < items.length; i++) {
    const ts = items[i]?.timestamp
    if (ts) return ts
  }
  return undefined
}

export function createTranscriptService(options: TranscriptServiceOptions): TranscriptService {
  const log = options.log ?? defaultLogger

  /** Archivo de la sesión según el índice, comprobado dentro de la carpeta de Claude Code. */
  async function locate(
    sessionId: string
  ): Promise<{ row: LocatedRow; ref: SessionFileRef } | null> {
    const reader = options.reader
    if (!reader) throw new TranscriptReadError(t('El índice no está disponible'))
    const row = reader
      .prepare<[string], LocatedRow>(
        'SELECT file, conversation_id FROM sessions WHERE session_id = ?'
      )
      .get(sessionId)
    if (!row) return null
    if (!isInside(row.file, options.claudeDir())) {
      log.warn('transcript', `Sesión fuera de la carpeta de Claude Code: ${sessionId}`)
      return null
    }
    try {
      return { row, ref: await sessionRefFromFile(row.file) }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      log.error('transcript', error)
      throw new TranscriptReadError(t('No se pudo leer la sesión'))
    }
  }

  /** `uuid` de las sesiones anteriores a `sessionId` en su conversación, en orden. */
  function previousLines(
    sessionId: string,
    conversationId: string
  ): { sessionId: string; uuids: Set<string> }[] {
    const reader = options.reader as Database.Database
    const chain = orderChain(
      reader
        .prepare<[string], { session_id: string; continued_from: string | null }>(
          `SELECT session_id, continued_from FROM sessions WHERE conversation_id = ?
           ORDER BY started_at IS NULL, started_at, session_id`
        )
        .all(conversationId)
    ).map((r) => r.session_id)
    const position = chain.indexOf(sessionId)
    const before = position > 0 ? chain.slice(0, position) : []
    if (before.length === 0) return []
    const rows = reader
      .prepare<[string], { session_id: string; uuid: string }>(
        `SELECT session_id, uuid FROM session_lines
         WHERE session_id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(before))
    const byId = new Map(before.map((id) => [id, new Set<string>()]))
    for (const r of rows) byId.get(r.session_id)?.add(r.uuid)
    return before.map((id) => ({ sessionId: id, uuids: byId.get(id) ?? new Set() }))
  }

  return {
    async transcript(sessionId, follow) {
      const started = performance.now()
      if (follow !== undefined) options.follower?.untrack(follow)
      const located = await locate(sessionId)
      if (!located) return null
      let loaded
      try {
        loaded = await loadSession(located.ref, {
          keep: follow !== undefined && !!options.follower
        })
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return null
        log.error('transcript', error)
        throw new TranscriptReadError(t('No se pudo leer la sesión'))
      }
      const { items, segments } = segmentsOf(
        sessionId,
        loaded.items,
        previousLines(sessionId, located.row.conversation_id)
      )
      const { summary, diagnostics } = loaded
      if (follow !== undefined && loaded.follow) {
        options.follower?.track(follow, sessionId, located.ref.file, loaded.follow)
      }
      log.info(
        'transcript',
        `Sesión ${sessionId} leída en ${Math.round(performance.now() - started)} ms · ${items.length} elementos`
      )
      return {
        sessionId,
        ...(summary.cwd ? { cwd: summary.cwd } : {}),
        items,
        segments,
        subagents: summary.subagents.map((s) => ({
          agentId: s.agentId,
          messageCount: s.messageCount,
          toolCallCount: s.toolCallCount,
          ...(s.agentType ? { agentType: s.agentType } : {}),
          ...(s.description ? { description: s.description } : {}),
          ...(s.toolUseId ? { toolUseId: s.toolUseId } : {})
        })),
        invalidLines: diagnostics.invalidCount,
        ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {})
      }
    },

    resumeTarget(sessionId) {
      const reader = options.reader
      if (!reader) return null
      const row = reader
        .prepare<[string], { conversation_id: string }>(
          'SELECT conversation_id FROM sessions WHERE session_id = ?'
        )
        .get(sessionId)
      if (!row) return null
      const chain = orderChain(
        reader
          .prepare<
            [string],
            { session_id: string; continued_from: string | null; start_cwd: string | null }
          >(
            `SELECT session_id, continued_from, start_cwd FROM sessions WHERE conversation_id = ?
             ORDER BY started_at IS NULL, started_at, session_id`
          )
          .all(row.conversation_id)
      )
      const last = chain[chain.length - 1]
      if (!last?.start_cwd) return null
      const model = reader
        .prepare<[string], { model: string }>(
          `SELECT model FROM session_usage WHERE session_id = ? AND agent_id IS NULL
           AND model <> '<synthetic>' ORDER BY timestamp DESC LIMIT 1`
        )
        .get(last.session_id)?.model
      return { sessionId: last.session_id, cwd: last.start_cwd, ...(model ? { model } : {}) }
    },

    async subagent(sessionId, agentId) {
      const located = await locate(sessionId)
      if (!located) return null
      try {
        const started = performance.now()
        const items = await loadSubagent(located.ref, agentId)
        log.info(
          'transcript',
          `Subagente ${agentId} de ${sessionId} leído en ${Math.round(performance.now() - started)} ms`
        )
        return items ? { agentId, items } : null
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return null
        log.error('transcript', error)
        throw new TranscriptReadError(t('No se pudo leer el subagente'))
      }
    }
  }
}
