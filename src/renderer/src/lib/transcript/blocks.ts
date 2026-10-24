import {
  LIVE_LINE_START,
  type ChatDraft,
  type PermissionDecision,
  type QueuedMessage
} from '../../../../shared/chat'
import type { TranscriptItem, TranscriptSegment } from '../../../../shared/sessions'
import type { Viewer } from '../../../../shared/types'
import { t } from '../../i18n'

/**
 * Capa de presentación del transcript: convierte los `TranscriptItem`
 * planos en bloques que pinta el visor. Pura y en una sola pasada; la usará también el chat de
 * el chat con datos en vivo.
 */

export interface ToolCallView {
  id: string
  name: string
  input: unknown
  result?: { text: string; isError: boolean }
  /**
   * `missing` = sin `tool-result` (interrumpida); `running` = sin resultado mientras la
   * sesión trabaja.
   */
  status: 'ok' | 'error' | 'missing' | 'running'
  subagent?: { agentId: string; agentType?: string; description?: string }
  /** Tiempo en curso según `tool_progress`. */
  elapsedMs?: number
  /** Decisión de su tarjeta de permiso, mientras la app siga abierta. */
  decision?: PermissionDecision
}

interface BlockBase {
  /**
   * `uuid:orden` del primer elemento (`l<línea>:orden` si no tiene): ancla y clave del plegado,
   * estable entre filtros y entre la versión en vivo y la de disco.
   */
  key: string
  line: number
  timestamp?: string
  /** Índice del segmento de la conversación (0 = la primera sesión). */
  segment: number
}

/** Paso de un grupo de actividad: un thinking con texto o una llamada. */
export type ActivityStep =
  { kind: 'thinking'; key: string; text: string } | { kind: 'call'; call: ToolCallView }

export type Block = BlockBase &
  /** `pending` = entregado por la app y aún no recibido por Claude. */
  (
    | { kind: 'user'; text: string; images: number; pending?: true }
    /** `streaming` = borrador del texto que está llegando. */
    | { kind: 'assistant'; text: string; model?: string; streaming?: true }
    /** `text` vacío = «Pensó» sin desplegable. */
    | { kind: 'thinking'; text: string }
    /**
     * Grupo de actividad: thinking y llamadas seguidos hasta el siguiente texto o prompt. `calls`
     * son las llamadas de `steps`, en orden.
     */
    | { kind: 'tools'; calls: ToolCallView[]; steps: ActivityStep[] }
    | {
        kind: 'command'
        name: string
        args: string
        output?: { text: string; stream: 'stdout' | 'stderr' }
      }
    | { kind: 'notice'; variant: 'interrupted' | 'task'; text: string }
    | { kind: 'duration'; ms: number }
    | { kind: 'internal'; label: string; text?: string }
    | { kind: 'separator'; variant: 'date' | 'resumed'; date?: string }
  )

export type BlockKind = Block['kind']

export interface LiveOptions {
  /** La sesión trabaja: las llamadas en vivo sin resultado están «en ejecución». */
  running: boolean
  progress?: Readonly<Record<string, number>>
  decisions?: Readonly<Record<string, PermissionDecision>>
  /** Texto en streaming: último bloque `assistant`. */
  draft?: ChatDraft | null
  /** Mensajes entregados que Claude aún no ha recibido: al final, atenuados. */
  pending?: readonly Pick<QueuedMessage, 'uuid' | 'text' | 'images'>[]
}

export interface BuildOptions {
  segments?: readonly Pick<TranscriptSegment, 'firstLine' | 'startedAt'>[]
  filters?: Viewer
  /** Datos de la sesión de chat activa. */
  live?: LiveOptions
  /**
   * `uuid` que se muestran aunque un filtro los oculte (salto a un mensaje): no
   * cambia los filtros guardados.
   */
  reveal?: ReadonlySet<string>
}

/**
 * Transcript de disco más los elementos en vivo que aún no están en disco: un
 * elemento en vivo sobra si su `uuid` ya está, o si es el prompt que en disco quedó plegado como
 * `queued_command` (con `sourceUuid`). Lo propio sin `uuid` (duración del turno) sigue hasta que
 * se concilia.
 */
export function mergeLive(
  disk: readonly TranscriptItem[],
  live: readonly TranscriptItem[]
): TranscriptItem[] {
  if (live.length === 0) return disk as TranscriptItem[]
  const known = diskIds(disk)
  const extra = live.filter((item) => !item.uuid || !known.has(item.uuid))
  return extra.length === 0 ? (disk as TranscriptItem[]) : [...disk, ...extra]
}

/** `uuid` de disco y `sourceUuid` de los prompts plegados: lo que ya no hace falta en vivo. */
export function diskIds(disk: readonly TranscriptItem[]): Set<string> {
  const known = new Set<string>()
  for (const item of disk) {
    if (item.uuid) known.add(item.uuid)
    if (item.kind === 'user-prompt' && item.sourceUuid) known.add(item.sourceUuid)
  }
  return known
}

const ALL: Viewer = { tools: true, thinking: true, internal: true }

/** Nombre legible de los `system` que solo se ven con el filtro de avisos internos. */
function systemLabel(subtype: string): string {
  return t('Aviso del sistema: {type}', { type: subtype })
}

/** Día local `AAAA-MM-DD` de un ISO, o `null` si no es una fecha. */
function localDay(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** Distribución sin separadores; el reparto por filtros y los separadores van aparte. */
type Raw = Exclude<Block, { kind: 'separator' }>

export function buildBlocks(items: readonly TranscriptItem[], options: BuildOptions = {}): Block[] {
  const baseFilters = options.filters ?? ALL
  const reveal = options.reveal
  let filters = baseFilters
  const live = options.live
  const segmentStarts = (options.segments ?? []).map((s) => s.firstLine)
  const segmentOf = (line: number): number => {
    let index = 0
    for (let i = 1; i < segmentStarts.length; i++) {
      if (line >= (segmentStarts[i] as number)) index = i
    }
    return index
  }

  const out: Raw[] = []
  const calls = new Map<string, ToolCallView>()
  /**
   * Grupo de actividad abierto: recoge llamadas y thinking hasta que un texto, un prompt u otro
   * bloque visible lo corta.
   */
  let group: Extract<Raw, { kind: 'tools' }> | null = null
  /**
   * Thinking aún sin grupo: si lo sigue una llamada, abre el grupo con ella; si no, se pinta
   * suelto. Los vacíos seguidos se funden en uno y, dentro de un grupo, se descartan.
   */
  let pendingThinking: Extract<Raw, { kind: 'thinking' }>[] = []
  const flushThinking = (): void => {
    out.push(...pendingThinking)
    pendingThinking = []
  }
  let lastId = ''
  let ordinal = 0

  const keyOf = (item: TranscriptItem): string => {
    // El prompt plegado tiene en disco otro `uuid`; el que lo une con el vivo es `sourceUuid`.
    const base =
      (item.kind === 'user-prompt' ? item.sourceUuid : undefined) ?? item.uuid ?? `l${item.line}`
    ordinal = base === lastId ? ordinal + 1 : 0
    lastId = base
    return `${base}:${ordinal}`
  }

  const base = (item: TranscriptItem, key: string): BlockBase => ({
    key,
    line: item.line,
    segment: segmentOf(item.line),
    ...(item.timestamp ? { timestamp: item.timestamp } : {})
  })

  /** Un bloque visible corta el grupo y deja ver el «Pensó» pendiente. */
  const push = (block: Raw, cutsGroup = true): void => {
    if (cutsGroup) {
      group = null
      flushThinking()
    }
    out.push(block)
  }

  const internal = (item: TranscriptItem, key: string, label: string, text?: string): void => {
    if (!filters.internal) return
    push({ ...base(item, key), kind: 'internal', label, ...(text ? { text } : {}) })
  }

  for (const item of items) {
    const key = keyOf(item)
    filters = reveal && item.uuid && reveal.has(item.uuid) ? ALL : baseFilters
    switch (item.kind) {
      case 'user-prompt':
        push({ ...base(item, key), kind: 'user', text: item.text, images: item.images })
        break
      case 'assistant-text':
        if (item.text.trim() === '') break
        push({
          ...base(item, key),
          kind: 'assistant',
          text: item.text,
          ...(item.model ? { model: item.model } : {})
        })
        break
      case 'thinking': {
        if (!filters.thinking) break
        const text = item.text.trim() === '' ? '' : item.text
        if (group) {
          if (text) group.steps.push({ kind: 'thinking', key, text })
        } else if (text || pendingThinking.length === 0) {
          pendingThinking.push({ ...base(item, key), kind: 'thinking', text })
        }
        break
      }
      case 'tool-use': {
        const decision = live?.decisions?.[item.id]
        const call: ToolCallView = {
          id: item.id,
          name: item.name,
          input: item.input,
          status: live?.running && item.line >= LIVE_LINE_START ? 'running' : 'missing',
          ...(decision ? { decision } : {})
        }
        const elapsed = live?.progress?.[item.id]
        if (elapsed !== undefined) call.elapsedMs = elapsed
        calls.set(item.id, call)
        if (!filters.tools) break
        if (!group) {
          // El thinking de delante entra en el grupo; los «Pensó» vacíos se absorben.
          const first = pendingThinking[0]
          group = {
            ...(first
              ? { key: first.key, line: first.line, segment: first.segment }
              : base(item, key)),
            ...(first?.timestamp ? { timestamp: first.timestamp } : {}),
            kind: 'tools',
            calls: [],
            steps: pendingThinking.flatMap((t) =>
              t.text ? [{ kind: 'thinking' as const, key: t.key, text: t.text }] : []
            )
          }
          pendingThinking = []
          out.push(group)
        }
        group.calls.push(call)
        group.steps.push({ kind: 'call', call })
        break
      }
      case 'tool-result': {
        const call = calls.get(item.toolUseId)
        if (call && !call.result) {
          call.result = { text: item.text, isError: item.isError }
          call.status = item.isError ? 'error' : 'ok'
          delete call.elapsedMs
        } else {
          internal(item, key, t('Resultado de herramienta sin llamada'), item.text)
        }
        break
      }
      case 'subagent-ref': {
        const call = calls.get(item.toolUseId)
        const subagent = {
          agentId: item.agentId,
          ...(item.agentType ? { agentType: item.agentType } : {}),
          ...(item.description ? { description: item.description } : {})
        }
        if (call) call.subagent = subagent
        else
          internal(
            item,
            key,
            t('Subagente sin llamada: {name}', { name: item.agentType ?? item.agentId })
          )
        break
      }
      case 'command':
        push({ ...base(item, key), kind: 'command', name: item.name, args: item.args })
        break
      case 'command-output': {
        const last = out[out.length - 1]
        if (last?.kind === 'command' && !last.output) {
          last.output = { text: item.text, stream: item.stream }
        } else {
          internal(item, key, t('Salida de comando'), item.text)
        }
        break
      }
      case 'task-notification':
        push({ ...base(item, key), kind: 'notice', variant: 'task', text: item.text })
        break
      case 'interrupted':
        push({ ...base(item, key), kind: 'notice', variant: 'interrupted', text: item.text })
        break
      case 'system':
        if (item.subtype === 'turn_duration' && typeof item.durationMs === 'number') {
          // La del turno en vivo no tiene `uuid` y la de disco sí: la clave sale del bloque
          // anterior para que sea la misma en las dos.
          const previous = out[out.length - 1]?.key ?? 'inicio'
          push({ ...base(item, `${previous}:duracion`), kind: 'duration', ms: item.durationMs })
        } else {
          internal(item, key, systemLabel(item.subtype), item.text)
        }
        break
      case 'meta':
        internal(item, key, t('Aviso interno'), item.text)
        break
      case 'attachment':
        internal(item, key, `Adjunto: ${item.attachmentType}`)
        break
      case 'unknown':
        internal(
          item,
          key,
          t('Elemento no reconocido: {type}', { type: item.originalType }),
          item.reason
        )
        break
    }
  }
  flushThinking()

  const draft = live?.draft
  if (draft && draft.text.trim()) {
    const last = out[out.length - 1]
    out.push({
      key: `draft:${draft.messageId}`,
      line: (last?.line ?? 0) + 1,
      segment: last?.segment ?? 0,
      kind: 'assistant',
      text: draft.text,
      streaming: true
    })
  }

  // Con la misma clave que tendrá el prompt al llegar: la fila pasa de atenuada a normal.
  const known = live?.pending?.length ? new Set(items.map((i) => i.uuid)) : null
  for (const message of live?.pending ?? []) {
    if (known?.has(message.uuid)) continue
    const last = out[out.length - 1]
    out.push({
      key: `${message.uuid}:0`,
      line: (last?.line ?? 0) + 1,
      segment: last?.segment ?? 0,
      kind: 'user',
      text: message.text,
      images: message.images ?? 0,
      pending: true
    })
  }

  return withSeparators(out, options.segments ?? [])
}

/** Separadores de fecha y «Reanudada aquí» sobre lo que queda tras los filtros. */
function withSeparators(
  blocks: Raw[],
  segments: readonly Pick<TranscriptSegment, 'startedAt'>[]
): Block[] {
  const out: Block[] = []
  let day: string | null = null
  let segment = 0
  for (const block of blocks) {
    if (block.segment > segment) {
      segment = block.segment
      const startedAt = segments[segment]?.startedAt ?? block.timestamp
      out.push({
        key: `resumed:${segment}`,
        line: block.line,
        segment,
        kind: 'separator',
        variant: 'resumed',
        ...(startedAt ? { date: startedAt, timestamp: startedAt } : {})
      })
    }
    const blockDay = localDay(block.timestamp)
    if (blockDay && blockDay !== day) {
      day = blockDay
      out.push({
        // Por día, no por bloque: el primer bloque del día cambia con los filtros.
        key: `date:${blockDay}`,
        line: block.line,
        segment: block.segment,
        kind: 'separator',
        variant: 'date',
        date: block.timestamp as string,
        timestamp: block.timestamp as string
      })
    }
    out.push(block)
  }
  return out
}

/**
 * Bloque que contiene el elemento `uuid` (salto a un mensaje). Con `toolUseId`, el
 * grupo de herramientas de esa llamada; si no, el bloque cuya clave empieza por el `uuid`
 * (preferido del tipo `prefer`), o el grupo que lo lleva como paso de thinking. `null`
 * si ya no está.
 */
export function blockOfUuid(
  blocks: readonly Block[],
  uuid: string,
  opts: { toolUseId?: string; prefer?: BlockKind } = {}
): Block | null {
  const { toolUseId, prefer } = opts
  if (toolUseId) {
    const group = blocks.find((b) => b.kind === 'tools' && b.calls.some((c) => c.id === toolUseId))
    if (group) return group
  }
  const prefix = `${uuid}:`
  let first: Block | null = null
  for (const block of blocks) {
    if (!block.key.startsWith(prefix)) continue
    if (!prefer || block.kind === prefer) return block
    first ??= block
  }
  return first ?? blocks.find((b) => thinkingStepOf(b, uuid) !== null) ?? null
}

/** Clave del paso de thinking `uuid` dentro de un grupo de actividad, o `null`. */
export function thinkingStepOf(block: Block, uuid: string): string | null {
  if (block.kind !== 'tools') return null
  const prefix = `${uuid}:`
  const step = block.steps.find((s) => s.kind === 'thinking' && s.key.startsWith(prefix))
  return step?.kind === 'thinking' ? step.key : null
}

/** Índice del bloque con `key`, o del último anterior por línea si ya no está (ancla). */
export function findAnchor(blocks: readonly Block[], key: string, line: number): number {
  const exact = blocks.findIndex((b) => b.key === key)
  if (exact !== -1) return exact
  let best = 0
  for (let i = 0; i < blocks.length; i++) {
    if ((blocks[i] as Block).line <= line) best = i
    else break
  }
  return best
}
