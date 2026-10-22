import type { ChatActivity, ChatErrorCode, ChatErrorView, ChatMode } from '../../../shared/chat'
import type { LimitWindow } from '../../../shared/usage'
import { readRateLimitEvent } from '../sdk-usage'
import type { TranscriptItem } from '../../../shared/sessions'
import { SdkRecords } from './sdk-records'

/**
 * Traducción de los mensajes del Agent SDK. Tolerante: recibe `unknown`,
 * ignora lo que no reconoce (y lo cuenta) y nunca lanza. Nunca registra contenido. El
 * estado (borrador del texto en streaming, acumuladores de `sdk-records`) es por sesión.
 */

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export type CommandState = 'queued' | 'started' | 'completed' | 'cancelled'

/** Lo que la sesión necesita de cada mensaje; ella lo convierte en `ChatEvent`. */
export type MappedEvent =
  | { kind: 'init'; sessionId: string; model: string; cwd: string; mode?: ChatMode }
  | { kind: 'items'; items: TranscriptItem[] }
  | { kind: 'subagent-items'; toolUseId: string; items: TranscriptItem[] }
  /** Texto acumulado del bloque en streaming del hilo principal. */
  | { kind: 'draft'; messageId: string; text: string }
  | { kind: 'draft-clear' }
  | { kind: 'activity'; activity: ChatActivity }
  | { kind: 'tool-progress'; toolUseId: string; elapsedMs: number }
  | { kind: 'lifecycle'; commandUuid: string; state: CommandState }
  /** `task_*` y `background_tasks_changed`, para `tasks.ts`. */
  | { kind: 'task'; message: Obj }
  | { kind: 'result'; subtype: string; isError: boolean; durationMs: number; detail?: string }
  | { kind: 'error'; error: ChatErrorView }
  | { kind: 'rate-limit'; window: LimitWindow }

const AUTH_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required'
])

const CHAT_ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  auth: 'Claude Code no tiene una sesión iniciada. Abre una terminal, ejecuta `claude` e inicia sesión.',
  'cli-missing': 'No se encuentra el ejecutable de Claude Code.',
  'invalid-cwd': 'La carpeta de trabajo no existe.',
  process:
    'Claude Code se ha cerrado de forma inesperada. Envía otro mensaje para reanudar la sesión.',
  turn: 'El turno ha terminado con un error.',
  unknown: 'Algo ha fallado al hablar con Claude Code.'
}

/** Texto en español del motivo de un `result` de error. */
const RESULT_ERRORS: Record<string, string> = {
  error_max_turns: 'Se alcanzó el límite de turnos.',
  error_max_budget_usd: 'Se alcanzó el límite de gasto.',
  error_during_execution: 'Error durante la ejecución.',
  error_max_structured_output_retries: 'No se pudo obtener una respuesta con el formato pedido.'
}

export function chatError(code: ChatErrorCode, detail?: string, message?: string): ChatErrorView {
  return {
    code,
    message: message ?? CHAT_ERROR_MESSAGES[code],
    ...(detail ? { detail } : {})
  }
}

export function resultErrorMessage(subtype: string): string {
  return RESULT_ERRORS[subtype] ?? CHAT_ERROR_MESSAGES.turn
}

/** Tipo de bloque del streaming → actividad; los demás no cuentan. */
const BLOCK_ACTIVITY: Record<string, ChatActivity | undefined> = {
  thinking: 'thinking',
  redacted_thinking: 'thinking',
  text: 'writing',
  tool_use: 'tool',
  server_tool_use: 'tool'
}

const MODES = new Set<string>(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
const COMMAND_STATES = new Set<string>(['queued', 'started', 'completed', 'cancelled'])
const TASK_SUBTYPES = new Set([
  'task_started',
  'task_progress',
  'task_updated',
  'task_notification',
  'background_tasks_changed'
])
/** Mensajes conocidos que no hacen falta: no cuentan como desconocidos. */
const KNOWN_IGNORED = new Set([
  'auth_status',
  'tool_use_summary',
  'prompt_suggestion',
  'memory_recall',
  'files_persisted',
  'elicitation_complete',
  'permission_denied',
  'informational',
  'notification',
  'model_refusal_fallback',
  'model_refusal_no_fallback'
])

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is Obj => isObj(block) && block['type'] === 'text')
    .map((block) => str(block['text']) ?? '')
    .join('')
}

export class SdkMapper {
  private readonly records = new SdkRecords()
  private draft: { messageId: string; index: number; text: string } | null = null
  private messageId: string | null = null
  /** Mensajes que no se reconocen: solo se cuentan para el log. */
  unknown = 0

  /** Línea para un elemento en vivo propio, en el mismo orden que los del SDK. */
  nextLine(): number {
    return this.records.nextLine()
  }

  map(msg: unknown): MappedEvent[] {
    try {
      return this.mapUnsafe(msg)
    } catch {
      this.unknown += 1
      return []
    }
  }

  private mapUnsafe(msg: unknown): MappedEvent[] {
    if (!isObj(msg)) {
      this.unknown += 1
      return []
    }
    const type = str(msg['type'])
    switch (type) {
      case 'system':
        return this.mapSystem(msg)
      case 'stream_event':
        return this.mapStream(msg)
      case 'assistant':
        return this.mapAssistant(msg)
      case 'user':
        return this.mapRecords(msg)
      case 'tool_progress': {
        const toolUseId = str(msg['tool_use_id'])
        if (!toolUseId) return []
        return [
          {
            kind: 'tool-progress',
            toolUseId,
            elapsedMs: Math.round(num(msg['elapsed_time_seconds']) * 1000)
          }
        ]
      }
      case 'command_lifecycle': {
        const commandUuid = str(msg['command_uuid'])
        const state = str(msg['state'])
        if (!commandUuid || !state || !COMMAND_STATES.has(state)) return []
        return [{ kind: 'lifecycle', commandUuid, state: state as CommandState }]
      }
      case 'result':
        return this.mapResult(msg)
      case 'rate_limit_event': {
        const window = readRateLimitEvent(msg)
        return window ? [{ kind: 'rate-limit', window }] : []
      }
      default:
        if (!type || !KNOWN_IGNORED.has(type)) this.unknown += 1
        return []
    }
  }

  private mapSystem(msg: Obj): MappedEvent[] {
    const subtype = str(msg['subtype'])
    if (subtype === 'init') {
      const mode = str(msg['permissionMode'])
      return [
        {
          kind: 'init',
          sessionId: str(msg['session_id']) ?? '',
          model: str(msg['model']) ?? '',
          cwd: str(msg['cwd']) ?? '',
          ...(mode && MODES.has(mode) ? { mode: mode as ChatMode } : {})
        }
      ]
    }
    if (subtype && TASK_SUBTYPES.has(subtype)) return [{ kind: 'task', message: msg }]
    return []
  }

  private mapStream(msg: Obj): MappedEvent[] {
    if (msg['parent_tool_use_id'] != null) return []
    const event = msg['event']
    if (!isObj(event)) return []
    switch (event['type']) {
      case 'message_start': {
        const message = event['message']
        this.messageId =
          (isObj(message) && str(message['id'])) || str(msg['api_message_id']) || null
        return []
      }
      case 'content_block_start': {
        const block = event['content_block']
        if (!isObj(block)) return []
        const activity = BLOCK_ACTIVITY[str(block['type']) ?? '']
        if (!activity) return []
        const started: MappedEvent = { kind: 'activity', activity }
        if (activity !== 'writing') return [started]
        const messageId = this.messageId ?? str(msg['api_message_id'])
        if (!messageId) return [started]
        this.draft = { messageId, index: num(event['index']), text: str(block['text']) ?? '' }
        return this.draft.text ? [started, this.draftEvent()] : [started]
      }
      case 'content_block_delta': {
        const delta = event['delta']
        if (!isObj(delta) || delta['type'] !== 'text_delta' || !this.draft) return []
        if (num(event['index']) !== this.draft.index) return []
        const text = str(delta['text'])
        if (!text) return []
        this.draft.text += text
        return [this.draftEvent()]
      }
      default:
        return []
    }
  }

  private draftEvent(): MappedEvent {
    const draft = this.draft as { messageId: string; text: string }
    return { kind: 'draft', messageId: draft.messageId, text: draft.text }
  }

  private mapAssistant(msg: Obj): MappedEvent[] {
    const message = isObj(msg['message']) ? msg['message'] : {}
    const error = str(msg['error'])
    if (error && msg['parent_tool_use_id'] == null) {
      const code: ChatErrorCode = AUTH_ERRORS.has(error) ? 'auth' : 'unknown'
      const text = textOf(message['content']).trim()
      const out: MappedEvent[] = [
        { kind: 'error', error: chatError(code, text ? `${error}: ${text}` : error) }
      ]
      if (this.draft) {
        this.draft = null
        out.push({ kind: 'draft-clear' })
      }
      return out
    }
    const out = this.mapRecords(msg)
    // El mensaje completo sustituye al borrador del texto en streaming.
    if (
      this.draft &&
      msg['parent_tool_use_id'] == null &&
      str(message['id']) === this.draft.messageId &&
      out.some((e) => e.kind === 'items' && e.items.some((i) => i.kind === 'assistant-text'))
    ) {
      this.draft = null
      out.push({ kind: 'draft-clear' })
    }
    return out
  }

  private mapRecords(msg: Obj): MappedEvent[] {
    const { main, subagents } = this.records.add(msg)
    const out: MappedEvent[] = []
    if (main.length > 0) out.push({ kind: 'items', items: main })
    for (const sub of subagents) {
      if (sub.items.length > 0)
        out.push({ kind: 'subagent-items', toolUseId: sub.toolUseId, items: sub.items })
    }
    return out
  }

  private mapResult(msg: Obj): MappedEvent[] {
    const subtype = str(msg['subtype']) ?? 'success'
    const isError = msg['is_error'] === true || subtype !== 'success'
    const errors = Array.isArray(msg['errors'])
      ? msg['errors'].filter((e): e is string => typeof e === 'string')
      : []
    const detail = errors.join('\n') || (isError ? str(msg['result']) : undefined)
    const out: MappedEvent[] = []
    if (this.draft) {
      this.draft = null
      out.push({ kind: 'draft-clear' })
    }
    out.push({
      kind: 'result',
      subtype,
      isError,
      durationMs: num(msg['duration_ms']),
      ...(detail ? { detail } : {})
    })
    return out
  }
}

/**
 * Convierte una excepción de `query()` en el error que verá la UI. `null` si se abortó a
 * propósito (detener, cerrar la sesión o la app).
 */
export function mapRunError(error: unknown, aborted: boolean): ChatErrorView | null {
  if (aborted) return null
  const detail = error instanceof Error ? error.message : String(error)
  // El SDK lanza "Claude Code native binary not found at …" o "… exists but failed to launch".
  if (/native (cli )?binary/i.test(detail)) return chatError('cli-missing', detail)
  if (/not logged in|\/login|authentication/i.test(detail)) return chatError('auth', detail)
  if (/exited with code|process exited|terminated|killed|EPIPE/i.test(detail))
    return chatError('process', detail)
  return chatError('unknown', detail)
}

/** Intervalo mínimo entre dos `text-delta` de una sesión. */
const DRAFT_INTERVAL_MS = 50

export interface DraftPacer {
  /** El primer borrador sale al momento; los siguientes, como mucho uno cada `interval`. */
  push(draft: { messageId: string; text: string }): void
  /** Emite ya el borrador pendiente, si lo hay. */
  flush(): void
  /** Descarta el pendiente (el mensaje completo lo sustituye). */
  clear(): void
}

export interface PacerClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

const realClock: PacerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>)
}

export function createDraftPacer(
  emit: (draft: { messageId: string; text: string }) => void,
  interval = DRAFT_INTERVAL_MS,
  clock: PacerClock = realClock
): DraftPacer {
  let last = -Infinity
  let pending: { messageId: string; text: string } | null = null
  let timer: unknown = null

  const fire = (): void => {
    timer = null
    if (!pending) return
    const draft = pending
    pending = null
    last = clock.now()
    emit(draft)
  }

  return {
    push(draft) {
      pending = draft
      const wait = last + interval - clock.now()
      if (wait <= 0) {
        if (timer) clock.clearTimeout(timer)
        fire()
      } else if (!timer) {
        timer = clock.setTimeout(fire, wait)
      }
    },
    flush() {
      if (timer) clock.clearTimeout(timer)
      fire()
    },
    clear() {
      if (timer) clock.clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
