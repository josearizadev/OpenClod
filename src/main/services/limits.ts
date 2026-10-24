import type { LimitHitKind } from '../../shared/sessions'
import type { LimitKind, LimitsSnapshot, LimitSource, LimitWindow } from '../../shared/usage'
import type { Logger } from './logger'
import { readUsageResponse } from './sdk-usage'
import { ProbeUnsupported } from './usage-probe'
import { t } from '../i18n'

/**
 * Estado de los límites: fusiona las fuentes por prioridad y caducidad,
 * programa un único temporizador a la próxima renovación y decide cuándo preguntar a Claude Code.
 */

const PRIORITY: LimitSource[] = ['sdk-usage', 'chat-event', 'session-hit', 'estimate']
const CHAT_MIN_MS = 60_000
const PROBE_MIN_MS = 120_000
const FORCED_MIN_MS = 30_000
/** Un evento de chat sin hora de renovación vale este tiempo. */
const NO_RESET_TTL_MS = 5 * 60_000

export interface IndexLimits {
  hits: { timestamp: string; kind: LimitHitKind; status: string; resetsAt: string | null }[]
  /** Bloque activo estimado. */
  estimate: { start: string; end: string; tokens: number } | null
}

export interface LimitsDeps {
  emit(snapshot: LimitsSnapshot): void
  readIndex(): IndexLimits | null
  /** Consulta de uso por un chat abierto, o `null` si no hay ninguno con proceso. */
  chatUsage(): Promise<unknown> | null
  probe(): Promise<unknown>
  probeEnabled(): boolean
  save?(snapshot: LimitsSnapshot): void
  cache?: LimitsSnapshot | null
  now?: () => number
  log?: Pick<Logger, 'info' | 'warn'>
}

type Slot = 'fiveHour' | 'weekly'

function slotOf(kind: LimitKind | LimitHitKind): Slot | null {
  if (kind === 'five_hour') return 'fiveHour'
  if (kind === 'seven_day') return 'weekly'
  return null
}

export class LimitsService {
  private readonly windows = new Map<string, LimitWindow>()
  private perModel: LimitWindow[] = []
  private subscription: string | null = null
  private probeState: LimitsSnapshot['probe'] = { state: 'idle' }
  private unavailable = false
  private lastChatAt = -Infinity
  private lastProbeAt = -Infinity
  private inflight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private last = ''
  private readonly now: () => number

  constructor(private readonly deps: LimitsDeps) {
    this.now = deps.now ?? Date.now
    try {
      const cache = deps.cache
      if (cache) {
        for (const w of [cache.fiveHour, cache.weekly])
          if (w && w.source !== 'estimate') this.put(w)
        this.perModel = cache.perModel.filter((w) => this.valid(w))
        this.subscription = typeof cache.subscription === 'string' ? cache.subscription : null
      }
    } catch {
      // Caché con otra forma: se empieza de cero.
      this.windows.clear()
      this.perModel = []
    }
  }

  snapshot(): LimitsSnapshot {
    return {
      fiveHour: this.pick('fiveHour'),
      weekly: this.pick('weekly'),
      perModel: this.perModel.filter((w) => this.valid(w)),
      subscription: this.subscription,
      probe: { ...this.probeState }
    }
  }

  fromChatEvent(window: LimitWindow): void {
    if (!slotOf(window.kind)) return
    this.put(window)
    this.changed()
  }

  fromIndex(): void {
    const data = this.deps.readIndex()
    if (!data) return
    for (const key of [...this.windows.keys()])
      if (key.startsWith('session-hit:') || key.startsWith('estimate:')) this.windows.delete(key)
    for (const hit of data.hits) {
      const kind = slotOf(hit.kind) ? hit.kind : null
      if (!kind || !hit.resetsAt) continue
      const w: LimitWindow = {
        kind: kind as LimitKind,
        utilization: hit.status === 'rejected' ? 100 : null,
        status: hit.status === 'rejected' ? 'rejected' : 'unknown',
        resetsAt: hit.resetsAt,
        source: 'session-hit',
        observedAt: hit.timestamp
      }
      const prev = this.windows.get(`session-hit:${kind}`)
      if (!prev || prev.observedAt < w.observedAt) this.put(w)
    }
    if (data.estimate) {
      this.put({
        kind: 'five_hour',
        utilization: null,
        status: 'unknown',
        resetsAt: data.estimate.end,
        startsAt: data.estimate.start,
        tokens: data.estimate.tokens,
        source: 'estimate',
        observedAt: new Date(this.now()).toISOString()
      })
    }
    this.changed()
  }

  /**
   * Pide los datos de uso a Claude Code: por un chat abierto (≥ 60 s entre consultas) o,
   * si se permite, con la sonda (≥ 120 s; `force` ≥ 30 s). Una consulta a la vez; nunca lanza.
   */
  requestUsage(opts: { allowProbe: boolean; force?: boolean }): Promise<void> {
    if (this.inflight) return this.inflight
    const now = this.now()
    let call: Promise<unknown> | null = null
    let viaProbe = false
    if (now - this.lastChatAt >= CHAT_MIN_MS) {
      call = this.deps.chatUsage()
      if (call) this.lastChatAt = now
    }
    if (!call && opts.allowProbe && this.deps.probeEnabled() && !this.unavailable) {
      const min = opts.force ? FORCED_MIN_MS : PROBE_MIN_MS
      if (now - this.lastProbeAt >= min) {
        this.lastProbeAt = now
        viaProbe = true
        this.probeState = { state: 'running' }
        this.changed()
        call = this.deps.probe()
      }
    }
    if (!call) return Promise.resolve()
    this.inflight = call
      .then((raw) => this.applyUsage(raw))
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : t('La consulta de uso falló')
        if (error instanceof ProbeUnsupported) this.unavailable = true
        this.probeState = {
          state: error instanceof ProbeUnsupported ? 'unavailable' : 'error',
          reason,
          at: new Date(this.now()).toISOString()
        }
        this.deps.log?.warn('usage', `Consulta de uso${viaProbe ? ' (sonda)' : ''}: ${reason}`)
      })
      .finally(() => {
        this.inflight = null
        this.changed()
      })
    return this.inflight
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.timer = this.saveTimer = null
  }

  private applyUsage(raw: unknown): void {
    const at = new Date(this.now()).toISOString()
    const parsed = readUsageResponse(raw, this.now())
    if ('unavailable' in parsed) {
      this.unavailable = true
      this.probeState = { state: 'unavailable', reason: parsed.unavailable, at }
      return
    }
    if (parsed.fiveHour) this.put(parsed.fiveHour)
    if (parsed.weekly) this.put(parsed.weekly)
    this.perModel = parsed.perModel
    this.subscription = parsed.subscription
    this.probeState = { state: 'ok', at }
  }

  private put(w: LimitWindow): void {
    const slot = slotOf(w.kind)
    if (slot) this.windows.set(`${w.source}:${w.kind}`, w)
  }

  private valid(w: LimitWindow): boolean {
    const now = this.now()
    if (w.resetsAt) return Date.parse(w.resetsAt) > now
    return Date.parse(w.observedAt) + NO_RESET_TTL_MS > now
  }

  private pick(slot: Slot): LimitWindow | null {
    const kind = slot === 'fiveHour' ? 'five_hour' : 'seven_day'
    for (const source of PRIORITY) {
      const w = this.windows.get(`${source}:${kind}`)
      if (w && this.valid(w)) return w
    }
    return null
  }

  private changed(): void {
    const snapshot = this.snapshot()
    this.schedule()
    const text = JSON.stringify(snapshot)
    if (text === this.last) return
    this.last = text
    this.deps.emit(snapshot)
    if (this.deps.save) {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        this.deps.save?.(this.snapshot())
      }, 5000)
    }
  }

  /** Un solo temporizador a la próxima caducidad. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const now = this.now()
    let next = Infinity
    for (const w of [...this.windows.values(), ...this.perModel]) {
      const end = w.resetsAt ? Date.parse(w.resetsAt) : Date.parse(w.observedAt) + NO_RESET_TTL_MS
      if (end > now) next = Math.min(next, end)
    }
    if (next === Infinity) return
    this.timer = setTimeout(
      () => {
        this.timer = null
        for (const [key, w] of this.windows) if (!this.valid(w)) this.windows.delete(key)
        this.changed()
      },
      Math.min(next - now + 50, 2 ** 31 - 1)
    )
  }
}
