import type { LimitKind, LimitWindow, LimitWindowStatus } from '../../shared/usage'

/**
 * Guardas tolerantes para los datos de límites del Agent SDK. Solo copian
 * la lista blanca: estado, porcentaje, renovación, tipo de ventana y suscripción. Nunca
 * lanzan.
 */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const STATUSES = new Set(['allowed', 'allowed_warning', 'rejected'])
const KINDS = new Set(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'])

/** Nombre del método experimental (cambiará cuando se estabilice). */
const USAGE_METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'

function utilization(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  // Comprobado con el SDK 0.3.299: 0–100. Un 0–1 se normaliza por si cambia.
  const pct = value <= 1 && value > 0 && !Number.isInteger(value) ? value * 100 : value
  return Math.min(pct, 100)
}

function isoFromEpoch(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

function isoFromString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** `rate_limit_event` de un chat → ventana, o `null` si no tiene la forma esperada. */
export function readRateLimitEvent(msg: unknown, now = Date.now()): LimitWindow | null {
  if (!isObj(msg) || msg['type'] !== 'rate_limit_event' || !isObj(msg['rate_limit_info']))
    return null
  const info = msg['rate_limit_info']
  const status =
    typeof info['status'] === 'string' && STATUSES.has(info['status']) ? info['status'] : null
  if (!status) return null
  const type = info['rateLimitType']
  return {
    kind: typeof type === 'string' && KINDS.has(type) ? (type as LimitKind) : 'unknown',
    utilization: utilization(info['utilization']),
    status: status as LimitWindowStatus,
    resetsAt: isoFromEpoch(info['resetsAt']),
    source: 'chat-event',
    observedAt: new Date(now).toISOString()
  }
}

export interface UsageResponse {
  fiveHour: LimitWindow | null
  weekly: LimitWindow | null
  perModel: LimitWindow[]
  subscription: string | null
}

function windowOf(raw: unknown, kind: LimitKind, at: string, label?: string): LimitWindow | null {
  if (!isObj(raw)) return null
  const pct = utilization(raw['utilization'])
  const resetsAt = isoFromString(raw['resets_at'])
  if (pct === null && resetsAt === null) return null
  return {
    kind,
    ...(label ? { label } : {}),
    utilization: pct,
    status: pct !== null && pct >= 100 ? 'rejected' : 'allowed',
    resetsAt,
    source: 'sdk-usage',
    observedAt: at
  }
}

/** Respuesta de la consulta de uso → ventanas, o el motivo por el que no hay datos. */
export function readUsageResponse(
  raw: unknown,
  now = Date.now()
): UsageResponse | { unavailable: string } {
  if (!isObj(raw)) return { unavailable: 'Respuesta de la consulta de uso no reconocida' }
  if (raw['rate_limits_available'] === false || !isObj(raw['rate_limits']))
    return { unavailable: 'Los límites del plan no se aplican a esta cuenta' }
  const at = new Date(now).toISOString()
  const limits = raw['rate_limits']
  const perModel: LimitWindow[] = []
  for (const kind of ['seven_day_opus', 'seven_day_sonnet'] as const) {
    const w = windowOf(limits[kind], kind, at)
    if (w) perModel.push(w)
  }
  if (Array.isArray(limits['model_scoped'])) {
    for (const item of limits['model_scoped'].slice(0, 20)) {
      if (!isObj(item) || typeof item['display_name'] !== 'string') continue
      const w = windowOf(item, 'model', at, item['display_name'].slice(0, 60))
      if (w) perModel.push(w)
    }
  }
  const sub = raw['subscription_type']
  return {
    fiveHour: windowOf(limits['five_hour'], 'five_hour', at),
    weekly: windowOf(limits['seven_day'], 'seven_day', at),
    perModel,
    subscription: typeof sub === 'string' && /^[a-z_]{1,30}$/.test(sub) ? sub : null
  }
}

/** Llama a la consulta de uso de un `Query` si existe; `null` si esta versión no la tiene. */
export function callUsage(query: unknown): Promise<unknown> | null {
  if (!isObj(query) && typeof query !== 'function') return null
  const fn = (query as Obj)[USAGE_METHOD]
  if (typeof fn !== 'function') return null
  return (fn as (opts: { skipBehaviors: boolean }) => Promise<unknown>).call(query, {
    skipBehaviors: true
  })
}
