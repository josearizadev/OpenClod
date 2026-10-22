import { z } from 'zod'
import type { TokenUsage } from './sessions'

/** Uso y límites. */

export type LimitSource = 'sdk-usage' | 'chat-event' | 'session-hit' | 'estimate'
export type LimitKind =
  'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'model' | 'unknown'
export type LimitWindowStatus = 'allowed' | 'allowed_warning' | 'rejected' | 'unknown'

export interface LimitWindow {
  kind: LimitKind
  /** Nombre que da el servidor para las ventanas por modelo. */
  label?: string
  /** 0–100, o `null` si no se conoce (la estimación local nunca lo da). */
  utilization: number | null
  status: LimitWindowStatus
  /** ISO. */
  resetsAt: string | null
  /** Solo en la estimación: inicio del bloque. */
  startsAt?: string
  /** Solo en la estimación: tokens del bloque. */
  tokens?: number
  source: LimitSource
  /** ISO: cuándo se obtuvo. */
  observedAt: string
}

export type ProbeState = 'idle' | 'running' | 'ok' | 'unavailable' | 'error'

export interface LimitsSnapshot {
  fiveHour: LimitWindow | null
  weekly: LimitWindow | null
  perModel: LimitWindow[]
  /** 'pro' | 'max' | … o null. */
  subscription: string | null
  probe: { state: ProbeState; reason?: string; at?: string }
}

export const EMPTY_LIMITS: LimitsSnapshot = {
  fiveHour: null,
  weekly: null,
  perModel: [],
  subscription: null,
  probe: { state: 'idle' }
}

export interface UsageBlock {
  start: string
  end: string
  lastMessageAt: string
  active: boolean
  /** Inicio tomado de una renovación real. */
  anchored: boolean
  /** Hubo aviso de límite dentro. */
  limitHit: boolean
  usage: TokenUsage
  tokens: number
  messages: number
  models: string[]
}

export interface CostTotal {
  usd: number
  partial: boolean
  missingSessions: number
}

export const UsagePeriodSchema = z.enum(['today', '7d', '30d', 'all'])
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>
export const UsageScopeSchema = z.enum(['project', 'all'])
export type UsageScope = z.infer<typeof UsageScopeSchema>

export const UsageQuerySchema = z
  .object({
    period: UsagePeriodSchema,
    scope: UsageScopeSchema,
    projectId: z.string().uuid().nullable()
  })
  .strict()
  .refine((q) => q.scope === 'all' || q.projectId !== null, {
    message: 'Falta el proyecto',
    path: ['projectId']
  })
export type UsageQuery = z.infer<typeof UsageQuerySchema>

export interface UsageDay {
  /** YYYY-MM-DD en la zona horaria local. */
  day: string
  byModel: Record<string, number>
  total: number
}

export interface UsageReport {
  range: { from: string | null; to: string }
  totals: { usage: TokenUsage; tokens: number; messages: number; sessions: number }
  daily: UsageDay[]
  byProject: {
    key: string
    name: string
    imported: boolean
    projectId?: string
    tokens: number
    messages: number
    cost?: CostTotal
  }[]
  byModel: { model: string; usage: TokenUsage; tokens: number; messages: number }[]
  topSessions: {
    sessionId: string
    title: string
    projectName: string
    tokens: number
    updatedAt?: string
    cost?: CostTotal
  }[]
  /** Bloques de 5 h del periodo, el más reciente primero. Siempre globales. */
  blocks: UsageBlock[]
  current: {
    block: UsageBlock | null
    ratePerMin: number
    projected: number | null
    referenceMax: number | null
  }
  cost?: CostTotal
  tookMs: number
}

export const UsageProbeInputSchema = z.object({ force: z.boolean() }).strict()
