import { EMPTY_USAGE, type TokenUsage } from '../../shared/sessions'
import type { UsageBlock } from '../../shared/usage'
import { addUsage } from './usage'

/**
 * Bloques de 5 h. Puro: recibe los mensajes con uso y las renovaciones
 * reales conocidas y devuelve los bloques. El algoritmo es intercambiable.
 */

export const BLOCK_MS = 5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/**
 * Alineación del inicio. `ccusage` usa la hora en punto; las renovaciones reales observadas
 * (2026-10-14/15) empiezan en el primer mensaje redondeado hacia abajo a 10 min (06:48 → 06:40,
 * 11:21 → 11:20), así que se usa eso.
 */
export const ALIGN_MS = 10 * 60 * 1000
const RATE_WINDOW_MS = 30 * 60 * 1000
const REFERENCE_MS = 30 * 24 * HOUR_MS

export interface BlockEvent {
  t: number
  usage: TokenUsage
  model: string
}

export interface BlockHit {
  t: number
  resetsAt?: number
}

export interface BlockAlgorithm {
  id: string
  blocks(events: readonly BlockEvent[], hits: readonly BlockHit[], now: number): UsageBlock[]
}

export function tokensOf(usage: TokenUsage): number {
  return usage.input + usage.output + usage.cacheCreation + usage.cacheRead
}

interface Draft {
  start: number
  end: number
  anchored: boolean
  last: number
  usage: TokenUsage
  messages: number
  models: Set<string>
}

/**
 * Tipo `ccusage`: un bloque empieza al primer mensaje que queda fuera del anterior, alineado a
 * `ALIGN_MS`, y dura 5 h; un hueco de más de 5 h lo cierra. Si una renovación
 * real `r` cubre al primer mensaje (`r − 5 h ≤ t < r`), el bloque se ancla a `[r − 5 h, r]`.
 */
export const ccusageBlocks: BlockAlgorithm = {
  id: 'ccusage',
  blocks(events, hits, now) {
    const sorted = [...events].sort((a, b) => a.t - b.t)
    const resets = [...new Set(hits.flatMap((h) => (h.resetsAt ? [h.resetsAt] : [])))].sort(
      (a, b) => a - b
    )
    const drafts: Draft[] = []
    let current: Draft | null = null
    for (const event of sorted) {
      if (!current || event.t >= current.end || event.t - current.last > BLOCK_MS) {
        const anchor = resets.find((r) => r - BLOCK_MS <= event.t && event.t < r)
        const start =
          anchor !== undefined ? anchor - BLOCK_MS : Math.floor(event.t / ALIGN_MS) * ALIGN_MS
        current = {
          start,
          end: start + BLOCK_MS,
          anchored: anchor !== undefined,
          last: event.t,
          usage: { ...EMPTY_USAGE },
          messages: 0,
          models: new Set()
        }
        drafts.push(current)
      }
      current.last = event.t
      current.usage = addUsage(current.usage, event.usage)
      current.messages += 1
      current.models.add(event.model)
    }
    return drafts.map((d) => ({
      start: new Date(d.start).toISOString(),
      end: new Date(d.end).toISOString(),
      lastMessageAt: new Date(d.last).toISOString(),
      active: now < d.end && now >= d.start,
      anchored: d.anchored,
      limitHit: hits.some((h) => h.t >= d.start && h.t < d.end),
      usage: d.usage,
      tokens: tokensOf(d.usage),
      messages: d.messages,
      models: [...d.models]
    }))
  }
}

/** Ritmo, proyección y referencia del bloque activo. */
export function currentBlockInfo(
  blocks: readonly UsageBlock[],
  events: readonly BlockEvent[],
  now: number
): {
  block: UsageBlock | null
  ratePerMin: number
  projected: number | null
  referenceMax: number | null
} {
  const block = blocks.find((b) => b.active) ?? null
  let recent = 0
  for (const e of events) if (e.t > now - RATE_WINDOW_MS && e.t <= now) recent += tokensOf(e.usage)
  const ratePerMin = block ? recent / 30 : 0
  const projected = block
    ? block.tokens + ratePerMin * Math.max(0, (Date.parse(block.end) - now) / 60000)
    : null
  let referenceMax: number | null = null
  for (const b of blocks) {
    if (b.active || Date.parse(b.end) < now - REFERENCE_MS) continue
    referenceMax = Math.max(referenceMax ?? 0, b.tokens)
  }
  return { block, ratePerMin, projected, referenceMax }
}
