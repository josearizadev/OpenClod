import { EMPTY_USAGE, type TokenUsage, type UsageEvent } from '../../shared/sessions'

/**
 * Uso de tokens sin contar dos veces. Un mensaje del asistente ocupa
 * varias líneas con el mismo `message.id` + `requestId`, y las sesiones continuadas copian
 * líneas y subagentes de la anterior: todo se fusiona por clave tomando el máximo de cada campo.
 */

/** Modelo de los mensajes que genera el propio CLI (errores de API): no tienen uso real. */
export const SYNTHETIC_MODEL = '<synthetic>'

/** Clave de deduplicación, o `null` si el mensaje no debe contar. */
export function usageKey(messageId: unknown, requestId: unknown, model: unknown): string | null {
  if (typeof messageId !== 'string' || !messageId || model === SYNTHETIC_MODEL) return null
  return `${messageId}:${typeof requestId === 'string' ? requestId : ''}`
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Convierte el `usage` de la API (snake_case) en `TokenUsage`; lo que falte cuenta 0. */
export function readUsage(raw: unknown): TokenUsage {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_USAGE }
  const usage = raw as Record<string, unknown>
  return {
    input: count(usage['input_tokens']),
    output: count(usage['output_tokens']),
    cacheCreation: count(usage['cache_creation_input_tokens']),
    cacheRead: count(usage['cache_read_input_tokens'])
  }
}

export function maxUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheCreation: Math.max(a.cacheCreation, b.cacheCreation),
    cacheRead: Math.max(a.cacheRead, b.cacheRead)
  }
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead
  }
}

/** Conjunto de eventos de uso deduplicado por clave. */
export class UsageLedger {
  private readonly events = new Map<string, UsageEvent>()

  add(events: Iterable<UsageEvent>): void {
    for (const event of events) {
      const previous = this.events.get(event.key)
      this.events.set(
        event.key,
        previous ? { ...previous, usage: maxUsage(previous.usage, event.usage) } : { ...event }
      )
    }
  }

  get size(): number {
    return this.events.size
  }

  values(): UsageEvent[] {
    return [...this.events.values()]
  }

  total(): TokenUsage {
    let total = { ...EMPTY_USAGE }
    for (const event of this.events.values()) total = addUsage(total, event.usage)
    return total
  }
}
