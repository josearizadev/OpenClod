import { z } from 'zod'

/**
 * Modelo de las sesiones de Claude Code. Lo que cruza IPC se define con zod;
 * el resto son tipos que el main produce y que el visor reutilizará.
 */

export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheCreation: z.number(),
  cacheRead: z.number()
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }

/** Ventanas de límite que nombra Claude Code; lo no reconocido queda como `unknown`. */
export const LIMIT_KINDS = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_overage_included',
  'overage'
] as const
export type LimitHitKind = (typeof LIMIT_KINDS)[number] | 'unknown'

export const LIMIT_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const
export type LimitStatus = (typeof LIMIT_STATUSES)[number] | 'unknown'

/** Aviso de límite alcanzado que Claude Code guardó en la sesión. Nada más de la línea. */
export interface LimitHit {
  line: number
  timestamp: string
  kind: LimitHitKind
  status: LimitStatus
  /** ISO; ausente si el aviso no la traía. */
  resetsAt?: string
}

/**
 * Coste acumulado de un proceso de Claude Code según sus líneas `cost-state`.
 * Es el total del proceso (`startTime`), no de la sesión: una continuación lo arrastra.
 */
export interface CostPoint {
  startTime: number
  totalUsd: number
  /** Fecha de la última línea con fecha anterior (las `cost-state` no tienen). */
  timestamp?: string
  unknownModel: boolean
}

/** Uso de un mensaje del asistente, identificado por `message.id:requestId`. */
export interface UsageEvent {
  key: string
  model: string
  /** ISO de la primera línea del mensaje. */
  timestamp?: string
  usage: TokenUsage
  /** Presente si el mensaje es de un subagente. */
  agentId?: string
}

interface ItemBase {
  /** Número de línea (desde 1) en su archivo. */
  line: number
  uuid?: string
  timestamp?: string
  sidechain: boolean
  /** Copiado de la sesión anterior de la conversación. */
  inherited?: true
}

export type TranscriptItem = ItemBase &
  (
    | {
        kind: 'user-prompt'
        text: string
        images: number
        /** Llegó a Claude a mitad de un turno (`queued_command` en disco). */
        queued?: true
        /** `uuid` del mensaje que envió la app o la terminal: sirve para conciliar. */
        sourceUuid?: string
      }
    | { kind: 'command'; name: string; args: string }
    | { kind: 'command-output'; text: string; stream: 'stdout' | 'stderr' }
    | { kind: 'task-notification'; text: string }
    | { kind: 'interrupted'; text: string }
    /** Avisos internos (`isMeta`, caveats, recordatorios del sistema). */
    | { kind: 'meta'; text: string }
    | { kind: 'assistant-text'; text: string; messageId?: string; model?: string }
    | { kind: 'thinking'; text: string; messageId?: string }
    | { kind: 'tool-use'; id: string; name: string; input: unknown; messageId?: string }
    | { kind: 'tool-result'; toolUseId: string; isError: boolean; text: string }
    | { kind: 'system'; subtype: string; text?: string; durationMs?: number }
    | {
        kind: 'subagent-ref'
        toolUseId: string
        agentId: string
        agentType?: string
        description?: string
      }
    /** Solo el tipo: el contenido de los adjuntos no sale del parser. */
    | { kind: 'attachment'; attachmentType: string }
    | { kind: 'unknown'; originalType: string; reason: string }
  )

export type TranscriptKind = TranscriptItem['kind']

export interface SubagentInfo {
  agentId: string
  agentType?: string
  description?: string
  /** `tool_use` (`Agent`) del archivo principal que lo lanzó. */
  toolUseId?: string
  file: string
  messageCount: number
  toolCallCount: number
}

/** Parte de un transcript copiada de una sesión anterior de la conversación, o la propia. */
export interface TranscriptSegment {
  sessionId: string
  /** Primera línea del archivo abierto que pertenece a este segmento. */
  firstLine: number
  /** Fecha del primer elemento del segmento («Reanudada el 12 sept a las 18:04»). */
  startedAt?: string
}

/** Transcript de una sesión para el visor. */
export interface TranscriptPayload {
  sessionId: string
  /** Para mostrar rutas relativas en las herramientas. */
  cwd?: string
  /** Archivo principal, sin los elementos de los subagentes. */
  items: TranscriptItem[]
  /** Uno por sesión de la cadena hasta esta, en orden; con una sesión suelta, uno solo. */
  segments: TranscriptSegment[]
  subagents: Pick<
    SubagentInfo,
    'agentId' | 'agentType' | 'description' | 'messageCount' | 'toolCallCount' | 'toolUseId'
  >[]
  invalidLines: number
  /** `updatedAt` del resumen recién calculado: lo compara el aviso de mensajes nuevos. */
  updatedAt?: string
}

/** Lo nuevo de la sesión que sigue una ventana: evento `sessions:appended`. */
export interface TranscriptAppend {
  sessionId: string
  /** Nuevos del archivo principal, en orden. */
  items: TranscriptItem[]
  /** Lista completa de subagentes si cambió (recuentos, nuevos). */
  subagents?: TranscriptPayload['subagents']
  /** Nuevos de cada subagente. */
  subagentItems?: Record<string, TranscriptItem[]>
  /** El archivo encogió, se reescribió o ya no está: el renderer recarga entero. */
  reset?: true
  /** Entrada de la lista a la que lleva el aviso de continuación. */
  continuedIn?: string
  updatedAt?: string
  /** `mtime` del archivo (ms), para medir la latencia del vivo. */
  writtenAt: number
}

export interface SubagentTranscript {
  agentId: string
  items: TranscriptItem[]
}

export interface SessionDiagnostics {
  lines: number
  invalidCount: number
  /** Números de línea con JSON inválido (como mucho los 50 primeros). */
  invalidLines: number[]
  unknownLineTypes: Record<string, number>
  unknownBlockTypes: Record<string, number>
  cliVersions: string[]
}

export type TitleSource = 'app' | 'agent-name' | 'ai-title' | 'prompt' | 'command' | 'none'

export interface SessionSummary {
  sessionId: string
  file: string
  cwd?: string
  title: string
  titleSource: TitleSource
  preview?: string
  startedAt?: string
  updatedAt?: string
  gitBranch?: string
  models: string[]
  cliVersions: string[]
  messageCount: number
  toolCallCount: number
  /** Principal + subagentes, sin contar dos veces un mismo mensaje. */
  usage: TokenUsage
  /** Uso de lo escrito en esta sesión, sin lo heredado de la anterior. */
  ownUsage: TokenUsage
  /** Id de la primera sesión de la conversación; el propio si no es una continuación. */
  conversationId: string
  continuedIn?: string
  continuedFrom?: string
  /** Última línea copiada de la sesión anterior. */
  inheritedUntilLine?: number
  subagents: SubagentInfo[]
}

export const ClaudeDirSourceSchema = z.enum(['settings', 'env', 'default'])
export type ClaudeDirSource = z.infer<typeof ClaudeDirSourceSchema>

const CountsSchema = z.record(z.string(), z.number())

/** Informe del análisis de la carpeta de Claude Code para Diagnóstico. */
export const ClaudeScanReportSchema = z.object({
  dir: z.string(),
  source: ClaudeDirSourceSchema,
  ok: z.boolean(),
  reason: z.string().optional(),
  projects: z.number(),
  sessions: z.number(),
  subagents: z.number(),
  lines: z.number(),
  invalidLines: z.number(),
  unknownLineTypes: CountsSchema,
  unknownBlockTypes: CountsSchema,
  cliVersions: z.array(z.string()),
  usage: TokenUsageSchema,
  usageEvents: z.number(),
  sessionsWithIssues: z.array(
    z.object({ file: z.string(), invalidLines: z.number(), unknown: z.number() })
  ),
  /** Sesiones que continúan otra. */
  continuedSessions: z.number(),
  /** Conversaciones repartidas en 2 o más sesiones. */
  conversationLinks: z.number(),
  /** Parejas de sesiones que comparten líneas sin estar enlazadas. */
  unlinkedOverlaps: z.number(),
  /** `continued-in` hacia una sesión que no existe. */
  brokenLinks: z.number(),
  /** Detalle de las anomalías de enlace (como mucho 20). */
  linkIssues: z.array(z.string()),
  durationMs: z.number()
})
export type ClaudeScanReport = z.infer<typeof ClaudeScanReportSchema>
