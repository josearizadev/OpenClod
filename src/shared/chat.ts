import { z } from 'zod'
import type { MessageKey } from './i18n'
import type { LimitWindow } from './usage'
import type { TranscriptItem } from './sessions'

/**
 * Chat con Claude Code. Lo comparten el main (que traduce los mensajes del
 * Agent SDK) y el renderer, que no conoce los tipos del SDK.
 */

/** Primera línea de los elementos en vivo: no choca con las de disco; solo ordena. */
export const LIVE_LINE_START = 1_000_000

/** `waiting` = hay al menos un permiso o pregunta pendiente. */
export const ChatStatusSchema = z.enum(['starting', 'working', 'waiting', 'idle', 'closed'])
export type ChatStatus = z.infer<typeof ChatStatusSchema>

/** Modos que ofrece la app (pregunta abierta 2). */
export const ChatModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
export type ChatMode = z.infer<typeof ChatModeSchema>

/** Modos que se pueden guardar como preferencia: «Saltar permisos» nunca. */
export const SavedChatModeSchema = z.enum(['default', 'acceptEdits', 'plan'])

export const ChatModelSchema = z.object({
  value: z.string().max(100),
  /** Id completo al que equivale un alias (`sonnet` → `claude-sonnet-…`). */
  resolvedModel: z.string().max(100).optional(),
  displayName: z.string().max(200),
  description: z.string().max(1000)
})
export type ChatModel = z.infer<typeof ChatModelSchema>

export const ChatCommandSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(1000)
})
export type ChatCommand = z.infer<typeof ChatCommandSchema>

export interface QueuedMessage {
  /** Será el `uuid` del `SDKUserMessage` y el de la línea en disco. */
  uuid: string
  text: string
  /** Imágenes adjuntas: van con el mensaje, no se editan. */
  images?: number
  /** `sending` = entregado al SDK («Enviar ya»), aún no recibido por Claude. */
  state: 'queued' | 'sending'
}

export type PermissionKind = 'tool' | 'question' | 'plan'

export interface PermissionRequestView {
  /** Aleatorio, propio; vale una sola vez. */
  requestId: string
  toolUseId?: string
  toolName: string
  /** Para la vista previa (diff, comando, JSON). */
  input: unknown
  title?: string
  description?: string
  decisionReason?: string
  blockedPath?: string
  /** Reglas que añadiría «Permitir siempre», ya en texto («Bash(npm test:*)»…). */
  alwaysLabels: string[]
  kind: PermissionKind
  /** El SDK pide no ofrecer «Permitir siempre» en esta petición. */
  noAlways?: true
  createdAt: string
}

export type PermissionDecision = 'allowed' | 'always' | 'denied' | 'cancelled'

export interface TaskView {
  taskId: string
  toolUseId?: string
  /** `local_agent` → agent, `local_bash` → bash, resto → other. */
  type: 'agent' | 'bash' | 'other'
  description: string
  subagentType?: string
  /** `is_backgrounded`, y su cambio por `task_updated`. */
  background: boolean
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  /** `summary` o el nombre de la última herramienta. */
  lastProgress?: string
  toolUses?: number
}

export const ChatErrorCodeSchema = z.enum([
  'auth',
  'cli-missing',
  'invalid-cwd',
  'process',
  'turn',
  'unknown'
])
export type ChatErrorCode = z.infer<typeof ChatErrorCodeSchema>

export interface ChatErrorView {
  code: ChatErrorCode
  message: string
  /** Detalle técnico para el bloque plegable. */
  detail?: string
}

export interface ChatDraft {
  messageId: string
  /** Texto acumulado del bloque en streaming. */
  text: string
}

export type TurnResult = 'success' | 'interrupted' | 'error'

/**
 * Claude en Chrome en una sesión: `pending` = activado pero aún sin comprobar
 * (sin proceso o arrancando); `failed` = el servidor MCP no conecta (falta la extensión).
 */
export interface ChromeState {
  enabled: boolean
  status: 'off' | 'pending' | 'connected' | 'failed'
}

/**
 * Qué empezó a generar Claude, según el `content_block_start` del streaming:
 * pensar, escribir la respuesta o preparar una llamada a una herramienta. Se borra al llegar el
 * bloque completo y al empezar o terminar el turno.
 */
export type ChatActivity = 'thinking' | 'writing' | 'tool'

/** Estado completo de una sesión de chat al volver a ella. */
export interface ChatSnapshot {
  chatId: string
  seq: number
  sessionId: string | null
  cwd: string
  status: ChatStatus
  model: string | null
  mode: ChatMode
  queue: QueuedMessage[]
  permissions: PermissionRequestView[]
  /** Por `toolUseId`. */
  decisions: Record<string, PermissionDecision>
  tasks: TaskView[]
  /** Del turno en curso, aún sin conciliar con disco. */
  live: TranscriptItem[]
  /** Por `toolUseId` de la llamada `Agent`. */
  liveSubagents: Record<string, TranscriptItem[]>
  draft: ChatDraft | null
  /** Herramientas en curso: milisegundos según `tool_progress`. */
  progress: Record<string, number>
  error: ChatErrorView | null
  /** Inicio del turno en curso (ms), para «Trabajando · 12 s». */
  turnStartedAt: number | null
  /** Lo último que empezó a generar Claude en este turno. */
  activity: ChatActivity | null
  /** Comandos de esta sesión (dependen de su proyecto): autocompletado de `/`. */
  commands: ChatCommand[]
  /** Claude en Chrome. */
  chrome: ChromeState
}

export type ChatEventBody =
  | { kind: 'session'; sessionId: string; model: string; cwd: string }
  | { kind: 'status'; status: ChatStatus }
  | { kind: 'items'; items: TranscriptItem[] }
  | { kind: 'subagent-items'; toolUseId: string; items: TranscriptItem[] }
  /** Texto **acumulado** del bloque, como mucho cada 50 ms. */
  /** `at`: hora del main al emitirlo, para medir hasta la pintura. */
  | { kind: 'text-delta'; messageId: string; text: string; at?: number }
  /** El mensaje completo sustituye al borrador (o el turno terminó sin él). */
  | { kind: 'draft-clear' }
  | { kind: 'activity'; activity: ChatActivity }
  | { kind: 'tool-progress'; toolUseId: string; elapsedMs: number }
  | { kind: 'queue'; queue: QueuedMessage[] }
  /** Claude recibió un mensaje de la app (`command_lifecycle started`). */
  | { kind: 'delivered'; uuid: string; text: string; queued: boolean; timestamp: string }
  | { kind: 'permission'; request: PermissionRequestView }
  | {
      kind: 'permission-resolved'
      requestId: string
      toolUseId?: string
      decision: PermissionDecision
    }
  | { kind: 'tasks'; tasks: TaskView[] }
  | { kind: 'turn-start'; startedAt: number }
  | { kind: 'turn-end'; durationMs: number; result: TurnResult }
  | { kind: 'mode'; mode: ChatMode }
  | { kind: 'model'; model: string | null }
  | { kind: 'error'; error: ChatErrorView }
  | { kind: 'commands'; commands: ChatCommand[] }
  | { kind: 'chrome'; chrome: ChromeState }
  /** El renderer ya tiene estos `uuid` de disco: se descartan de `live`. */
  | { kind: 'reconciled'; uuids: string[] }
  /** `rate_limit_event` del SDK. */
  | { kind: 'rate-limit'; window: LimitWindow }

export type ChatEvent = { chatId: string; seq: number } & ChatEventBody

/** Para el evento `chat:event` del contrato: el main es la única fuente, sin validar en detalle. */
export const ChatEventSchema = z.custom<ChatEvent>()

export interface ChatActiveEntry {
  chatId: string
  sessionId: string | null
  status: ChatStatus
}

export interface ChatCatalog {
  models: ChatModel[]
  commands: ChatCommand[]
}

/** Aviso del main al cerrar la ventana con sesiones trabajando. */
export interface CloseRequest {
  working: number
  waiting: number
  /** Terminales con el proceso vivo. */
  terminals?: number
  /** Se cierra para instalar una actualización (y la app vuelve a abrirse). */
  restart?: boolean
}

// ---------------------------------------------------------------- entradas IPC

const SessionIdSchema = z.string().uuid()
const TextSchema = z.string().min(1).max(100_000)
const ModelValueSchema = z.string().min(1).max(100)

// ------------------------------------------------------------- adjuntos

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]
/** Tamaño máximo de una imagen ya decodificada (límite de la API). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const ATTACHMENTS_MAX = 20

/** Imagen sin archivo (pegada) en base64 sin prefijo, o archivo del disco por su ruta. */
export const ChatAttachmentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('image'),
      name: z.string().min(1).max(260),
      mediaType: z.enum(IMAGE_MEDIA_TYPES),
      data: z
        .string()
        .min(1)
        .max(Math.ceil(IMAGE_MAX_BYTES / 3) * 4)
    })
    .strict(),
  z
    .object({
      kind: z.literal('file'),
      name: z.string().min(1).max(260),
      path: z.string().min(1).max(1024)
    })
    .strict()
])
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>

const AttachmentsSchema = z.array(ChatAttachmentSchema).max(ATTACHMENTS_MAX).optional()
/** Con adjuntos el texto puede ir vacío. */
const hasContent = (p: { text: string; attachments?: unknown[] | undefined }): boolean =>
  p.text.trim() !== '' || (p.attachments?.length ?? 0) > 0
const EMPTY = { message: 'El mensaje está vacío' }

export const ChatStartInputSchema = z
  .object({
    cwd: z.string().min(1).max(1024),
    text: z.string().max(100_000),
    attachments: AttachmentsSchema,
    uuid: z.string().uuid().optional(),
    model: ModelValueSchema.nullable().optional(),
    mode: ChatModeSchema.optional(),
    /** Claude en Chrome; sin él, la preferencia del proyecto. */
    chrome: z.boolean().optional()
  })
  .strict()
  .refine(hasContent, EMPTY)

export const ChatSendInputSchema = z
  .object({
    sessionId: SessionIdSchema,
    text: z.string().max(100_000),
    attachments: AttachmentsSchema,
    uuid: z.string().uuid().optional(),
    now: z.boolean().optional(),
    /** Solo si hay que reanudar la sesión: Claude en Chrome. */
    chrome: z.boolean().optional()
  })
  .strict()
  .refine(hasContent, EMPTY)

export const ChatQueueEditInputSchema = z
  .object({ sessionId: SessionIdSchema, uuid: z.string().uuid(), text: TextSchema })
  .strict()

export const ChatQueueRefInputSchema = z
  .object({ sessionId: SessionIdSchema, uuid: z.string().uuid() })
  .strict()

export const ChatSessionRefSchema = z.object({ sessionId: SessionIdSchema }).strict()

const AnswerText = z.string().max(2000)

export const ChatPermissionInputSchema = z
  .object({
    sessionId: SessionIdSchema,
    requestId: z.string().uuid(),
    decision: z.enum(['allow', 'always', 'deny']),
    scope: z.enum(['session', 'project']).optional(),
    message: z.string().max(2000).optional(),
    answers: z.record(AnswerText, AnswerText).optional()
  })
  .strict()
export type ChatPermissionInput = z.infer<typeof ChatPermissionInputSchema>

export const ChatSetModelInputSchema = z
  .object({ sessionId: SessionIdSchema, model: ModelValueSchema.nullable() })
  .strict()

export const ChatSetModeInputSchema = z
  .object({ sessionId: SessionIdSchema, mode: ChatModeSchema })
  .strict()

export const ChatSetChromeInputSchema = z
  .object({ sessionId: SessionIdSchema, enabled: z.boolean() })
  .strict()

export const ChatStopTaskInputSchema = z
  .object({ sessionId: SessionIdSchema, taskId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) })
  .strict()

export const ChatReconciledInputSchema = z
  .object({ sessionId: SessionIdSchema, uuids: z.array(z.string().max(100)).max(100_000) })
  .strict()

/** Nombre legible de cada modo (clave de traducción). */
export const MODE_LABELS: Record<ChatMode, MessageKey> = {
  default: 'Preguntar',
  acceptEdits: 'Aceptar ediciones',
  plan: 'Planificar',
  bypassPermissions: 'Saltar permisos'
}
