import type { TokenUsage, TranscriptItem, UsageEvent } from '../../shared/sessions'
import type { LoadedSession } from './session-loader'
import { UsageLedger } from './usage'

/**
 * Conversaciones repartidas en varias sesiones. Al reanudar, Claude Code
 * crea una sesión nueva que empieza con una copia de la anterior y escribe `continued-in` al
 * final de la anterior. Aquí se enlazan las dos y cada mensaje se atribuye a la sesión donde
 * apareció por primera vez. Puro: no lee archivos.
 */

/** Lo mínimo de una sesión para enlazarla: no guarda los elementos (memoria acotada). */
export interface SessionFingerprint {
  sessionId: string
  continuedIn?: string
  uuids: ReadonlySet<string>
  usage: readonly UsageEvent[]
}

export interface ConversationLink {
  /** Id de la primera sesión de la cadena. */
  conversationId: string
  continuedFrom?: string
  /** `uuid` copiados de la sesión anterior. */
  inherited: ReadonlySet<string>
  /** Uso sin lo heredado. */
  ownUsage: TokenUsage
}

export interface ConversationGraph {
  links: Map<string, ConversationLink>
  /** Parejas que comparten líneas sin estar en la misma conversación. */
  unlinkedOverlaps: { a: string; b: string; lines: number }[]
  /** `continued-in` hacia una sesión que no está. */
  brokenLinks: { sessionId: string; missing: string }[]
}

const EMPTY_SET: ReadonlySet<string> = new Set()

export function fingerprintOf(loaded: LoadedSession): SessionFingerprint {
  const uuids = new Set<string>()
  for (const item of loaded.items) if (item.uuid) uuids.add(item.uuid)
  return {
    sessionId: loaded.summary.sessionId,
    ...(loaded.summary.continuedIn ? { continuedIn: loaded.summary.continuedIn } : {}),
    uuids,
    usage: loaded.usage
  }
}

function totalOf(events: Iterable<UsageEvent>): TokenUsage {
  const ledger = new UsageLedger()
  ledger.add(events)
  return ledger.total()
}

export function linkConversations(sessions: readonly SessionFingerprint[]): ConversationGraph {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]))
  const previous = new Map<string, string>() // destino → origen
  const brokenLinks: ConversationGraph['brokenLinks'] = []

  for (const session of sessions) {
    const target = session.continuedIn
    if (!target || target === session.sessionId) continue
    if (!byId.has(target) || previous.has(target)) {
      // Destino borrado, o ya reclamado por otra sesión: no se adivina.
      brokenLinks.push({ sessionId: session.sessionId, missing: target })
      continue
    }
    previous.set(target, session.sessionId)
  }

  const rootOf = (id: string): string => {
    const seen = new Set([id])
    let current = id
    for (let from = previous.get(current); from && !seen.has(from); from = previous.get(current)) {
      seen.add(from)
      current = from
    }
    return current
  }

  const links = new Map<string, ConversationLink>()
  for (const session of sessions) {
    const fromId = previous.get(session.sessionId)
    const from = fromId ? byId.get(fromId) : undefined
    if (!from) {
      links.set(session.sessionId, {
        conversationId: rootOf(session.sessionId),
        inherited: EMPTY_SET,
        ownUsage: totalOf(session.usage)
      })
      continue
    }
    const inherited = new Set<string>()
    for (const uuid of session.uuids) if (from.uuids.has(uuid)) inherited.add(uuid)
    // El uso de la anterior ya incluye lo que ella heredó y sus subagentes: vale en cadena.
    const previousKeys = new Set(from.usage.map((e) => e.key))
    links.set(session.sessionId, {
      conversationId: rootOf(session.sessionId),
      continuedFrom: from.sessionId,
      inherited,
      ownUsage: totalOf(session.usage.filter((e) => !previousKeys.has(e.key)))
    })
  }

  // Solapamientos entre conversaciones distintas: se informan, no se restan.
  const owner = new Map<string, string>()
  const overlaps = new Map<string, { a: string; b: string; lines: number }>()
  for (const session of sessions) {
    const conversation = links.get(session.sessionId)?.conversationId
    for (const uuid of session.uuids) {
      const first = owner.get(uuid)
      if (!first) {
        owner.set(uuid, session.sessionId)
        continue
      }
      if (links.get(first)?.conversationId === conversation) continue
      const [a, b] = [first, session.sessionId].sort() as [string, string]
      const key = `${a}|${b}`
      const entry = overlaps.get(key) ?? { a, b, lines: 0 }
      entry.lines += 1
      overlaps.set(key, entry)
    }
  }

  return { links, unlinkedOverlaps: [...overlaps.values()], brokenLinks }
}

/** Marca lo heredado y completa el resumen con el enlace. */
export function applyLink(
  loaded: LoadedSession,
  link: ConversationLink | undefined
): LoadedSession {
  if (!link) return loaded
  let inheritedUntilLine: number | undefined
  const items: TranscriptItem[] =
    link.inherited.size === 0
      ? loaded.items
      : loaded.items.map((item) => {
          if (!item.uuid || !link.inherited.has(item.uuid)) return item
          inheritedUntilLine = Math.max(inheritedUntilLine ?? 0, item.line)
          return { ...item, inherited: true }
        })
  return {
    ...loaded,
    items,
    summary: {
      ...loaded.summary,
      conversationId: link.conversationId,
      ownUsage: link.ownUsage,
      ...(link.continuedFrom ? { continuedFrom: link.continuedFrom } : {}),
      ...(inheritedUntilLine !== undefined ? { inheritedUntilLine } : {})
    }
  }
}
