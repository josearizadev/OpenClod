import { readFile } from 'node:fs/promises'
import type {
  SessionDiagnostics,
  SessionSummary,
  SubagentInfo,
  TranscriptItem,
  UsageEvent
} from '../../shared/sessions'
import type { SessionFileRef, SubagentFileRef } from './claude-paths'
import { readJsonl, type JsonlPosition } from './jsonl-reader'
import {
  compareVersions,
  previewOf,
  resolveTitle,
  SessionAccumulator,
  type SessionStats,
  type SubagentMeta
} from './session-parser'
import { UsageLedger } from './usage'
import { applyLink, fingerprintOf, linkConversations } from './conversations'

/**
 * Carga completa de una sesión: archivo principal + subagentes. El uso
 * suma los subagentes sin contar dos veces un mismo mensaje.
 */

export interface LoadedSession {
  summary: SessionSummary
  items: TranscriptItem[]
  /** Transcript de cada subagente, por `agentId`. */
  subagentItems: Map<string, TranscriptItem[]>
  usage: UsageEvent[]
  diagnostics: SessionDiagnostics
  /** Con `keep: true`: acumuladores y posiciones para seguir leyendo. */
  follow?: FollowState
}

/** Un archivo a medio leer: su acumulador (con los elementos) y dónde se quedó la lectura. */
export interface FollowedFile {
  acc: SessionAccumulator
  pos: JsonlPosition
}

export interface FollowState {
  main: FollowedFile
  subs: Map<string, FollowedFile & { meta: SubagentMetaFile; file: string }>
  /** Metadatos de subagentes por `tool_use`: el acumulador principal los consulta al vuelo. */
  byToolUse: Map<string, SubagentMeta>
}

export interface SubagentMetaFile extends SubagentMeta {
  toolUseId?: string
}

/** Lee `agent-<id>.meta.json`; si falta o no es válido, el subagente queda sin tipo ni descripción. */
export async function readMeta(ref: SubagentFileRef): Promise<SubagentMetaFile> {
  const meta: SubagentMetaFile = { agentId: ref.agentId }
  if (!ref.metaFile) return meta
  try {
    const raw: unknown = JSON.parse(await readFile(ref.metaFile, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return meta
    const obj = raw as Record<string, unknown>
    if (typeof obj['agentType'] === 'string') meta.agentType = obj['agentType']
    if (typeof obj['description'] === 'string') meta.description = obj['description']
    if (typeof obj['toolUseId'] === 'string') meta.toolUseId = obj['toolUseId']
  } catch {
    // Meta ilegible: se sigue sin ella.
  }
  return meta
}

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value
}

/** Datos de un subagente que necesita el resumen de la sesión. */
export interface SubagentSummaryInput {
  meta: SubagentMetaFile
  file: string
  stats: SessionStats
}

/**
 * Resumen y diagnóstico de una sesión a partir de los datos de sus archivos. Lo usan el cargador y
 * el índice para calcularlo igual. `ledger` lleva el uso ya combinado del
 * principal y los subagentes.
 */
export function buildSummary(
  ref: Pick<SessionFileRef, 'sessionId' | 'file'>,
  stats: SessionStats,
  subs: readonly SubagentSummaryInput[],
  ledger: UsageLedger,
  opts: { appTitle?: string } = {}
): { summary: SessionSummary; diagnostics: SessionDiagnostics } {
  const diagnostics: SessionDiagnostics = {
    ...stats.diagnostics,
    invalidLines: [...stats.diagnostics.invalidLines],
    unknownLineTypes: { ...stats.diagnostics.unknownLineTypes },
    unknownBlockTypes: { ...stats.diagnostics.unknownBlockTypes }
  }
  const versions = new Set(stats.cliVersions)
  const models = new Set(stats.models)
  const subagents: SubagentInfo[] = []

  for (const { meta, file, stats: sub } of subs) {
    for (const model of sub.models) models.add(model)
    for (const version of sub.cliVersions) versions.add(version)
    // Los números de línea inválidos se refieren al archivo principal; de los subagentes, el total.
    diagnostics.lines += sub.diagnostics.lines
    diagnostics.invalidCount += sub.diagnostics.invalidCount
    mergeCounts(diagnostics.unknownLineTypes, sub.diagnostics.unknownLineTypes)
    mergeCounts(diagnostics.unknownBlockTypes, sub.diagnostics.unknownBlockTypes)
    subagents.push({
      agentId: meta.agentId,
      ...(meta.agentType ? { agentType: meta.agentType } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.toolUseId ? { toolUseId: meta.toolUseId } : {}),
      file,
      messageCount: sub.messageCount,
      toolCallCount: sub.toolCallCount
    })
  }
  diagnostics.cliVersions = [...versions].sort(compareVersions)

  const { title, source } = resolveTitle({ ...stats, appTitle: opts.appTitle })
  const preview = previewOf(stats.lastPrompt)
  const usage = ledger.total()
  const summary: SessionSummary = {
    // El nombre del archivo es el identificador con el que Claude Code reanuda la sesión.
    sessionId: ref.sessionId,
    // Sin conocer las demás sesiones, la conversación es solo esta (ver conversations.ts).
    conversationId: ref.sessionId,
    file: ref.file,
    title,
    titleSource: source,
    models: [...models],
    cliVersions: diagnostics.cliVersions,
    messageCount: stats.messageCount,
    toolCallCount: stats.toolCallCount,
    usage,
    ownUsage: { ...usage },
    subagents,
    ...(stats.cwd ? { cwd: stats.cwd } : {}),
    ...(preview ? { preview } : {}),
    ...(stats.startedAt ? { startedAt: stats.startedAt } : {}),
    ...(stats.updatedAt ? { updatedAt: stats.updatedAt } : {}),
    ...(stats.gitBranch ? { gitBranch: stats.gitBranch } : {}),
    ...(stats.continuedIn ? { continuedIn: stats.continuedIn } : {})
  }
  return { summary, diagnostics }
}

export async function loadSession(
  ref: SessionFileRef,
  opts: { appTitle?: string; keep?: boolean } = {}
): Promise<LoadedSession> {
  const metas = await Promise.all(ref.subagents.map(readMeta))
  const byToolUse = new Map<string, SubagentMeta>()
  for (const meta of metas) if (meta.toolUseId) byToolUse.set(meta.toolUseId, meta)

  const main = new SessionAccumulator({ subagentsByToolUse: byToolUse })
  const mainChunk = await readJsonl(ref.file)
  main.addChunk(mainChunk)
  const follow: FollowState | undefined = opts.keep
    ? {
        main: { acc: main, pos: { offset: mainChunk.offset, line: mainChunk.line } },
        subs: new Map(),
        byToolUse
      }
    : undefined

  const ledger = new UsageLedger()
  ledger.add(main.usage)

  const subs: SubagentSummaryInput[] = []
  const subagentItems = new Map<string, TranscriptItem[]>()
  for (const [index, subRef] of ref.subagents.entries()) {
    const acc = new SessionAccumulator({ agentId: subRef.agentId })
    const chunk = await readJsonl(subRef.file)
    acc.addChunk(chunk)
    ledger.add(acc.usage)
    subagentItems.set(subRef.agentId, acc.items)
    const meta = metas[index] ?? { agentId: subRef.agentId }
    acc.drainItems()
    follow?.subs.set(subRef.agentId, {
      acc,
      pos: { offset: chunk.offset, line: chunk.line },
      meta,
      file: subRef.file
    })
    subs.push({
      meta,
      file: subRef.file,
      stats: acc.stats()
    })
  }

  const { summary, diagnostics } = buildSummary(ref, main.stats(), subs, ledger, opts)
  main.drainItems()
  return {
    summary,
    items: main.items.slice(),
    subagentItems,
    usage: ledger.values(),
    diagnostics,
    ...(follow ? { follow } : {})
  }
}

/**
 * Transcript de un solo subagente de la sesión: lee solo su archivo.
 * `null` si el subagente no cuelga de `ref`.
 */
export async function loadSubagent(
  ref: Pick<SessionFileRef, 'subagents'>,
  agentId: string
): Promise<TranscriptItem[] | null> {
  const subRef = ref.subagents.find((s) => s.agentId === agentId)
  if (!subRef) return null
  const acc = new SessionAccumulator({ agentId })
  acc.addChunk(await readJsonl(subRef.file))
  return acc.items
}

/**
 * Carga una sesión que continúa a `previous` y marca lo heredado. El índice de la
 * quien llama sabe qué sesión es la anterior; aquí se recibe ya resuelta.
 */
export async function loadContinuation(
  ref: SessionFileRef,
  previous: SessionFileRef,
  opts: { appTitle?: string } = {}
): Promise<LoadedSession> {
  const [loaded, before] = await Promise.all([loadSession(ref, opts), loadSession(previous)])
  const graph = linkConversations([fingerprintOf(before), fingerprintOf(loaded)])
  return applyLink(loaded, graph.links.get(loaded.summary.sessionId))
}
