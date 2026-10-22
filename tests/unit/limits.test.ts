import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitsService, type LimitsDeps } from '../../src/main/services/limits'
import { readRateLimitEvent, readUsageResponse } from '../../src/main/services/sdk-usage'
import {
  ProbeUnsupported,
  runUsageProbe,
  type ProbeFactory,
  type ProbeQuery
} from '../../src/main/services/usage-probe'
import type { LimitsSnapshot, LimitWindow } from '../../src/shared/usage'

const T0 = Date.parse('2026-10-15T09:00:00Z')

/** Respuesta real de la consulta de uso (SDK 0.3.299, 2026-10-15), recortada. */
const REAL = {
  session: { total_cost_usd: 0, model_usage: {} },
  subscription_type: 'pro',
  rate_limits_available: true,
  rate_limits: {
    five_hour: {
      utilization: 54,
      resets_at: '2026-10-15T11:40:00.409951+00:00',
      limit_dollars: null
    },
    seven_day: { utilization: 21, resets_at: '2026-10-20T09:00:00.409972+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    model_scoped: [],
    extra_usage: { is_enabled: true, used_credits: 12, monthly_limit: 50 }
  },
  behaviors: { day: { request_count: 3 } }
}

describe('sdk-usage', () => {
  it('lee la respuesta real y descarta lo que no está en la lista blanca', () => {
    const r = readUsageResponse(REAL, T0)
    expect(r).toEqual({
      fiveHour: {
        kind: 'five_hour',
        utilization: 54,
        status: 'allowed',
        resetsAt: '2026-10-15T11:40:00.409Z',
        source: 'sdk-usage',
        observedAt: '2026-10-15T09:00:00.000Z'
      },
      weekly: expect.objectContaining({ kind: 'seven_day', utilization: 21 }),
      perModel: [],
      subscription: 'pro'
    })
    expect(JSON.stringify(r)).not.toMatch(/extra|credits|behaviors|dollars/)
  })

  it('sin límites de plan o con formas raras', () => {
    expect(readUsageResponse({ rate_limits_available: false, rate_limits: null })).toEqual({
      unavailable: 'Los límites del plan no se aplican a esta cuenta'
    })
    expect(readUsageResponse('x')).toHaveProperty('unavailable')
    const odd = readUsageResponse({
      rate_limits: {
        five_hour: { utilization: 'mucho', resets_at: 'nunca' },
        model_scoped: [{ display_name: 'Fable', utilization: 0.5, resets_at: null }, 'x']
      },
      subscription_type: '<script>'
    })
    expect(odd).toMatchObject({ fiveHour: null, subscription: null })
    expect('perModel' in odd && odd.perModel[0]).toMatchObject({ label: 'Fable', utilization: 50 })
  })

  it('evento del chat con estado desconocido → null', () => {
    expect(readRateLimitEvent({ type: 'rate_limit_event', rate_limit_info: {} })).toBeNull()
    expect(readRateLimitEvent({ type: 'otro' })).toBeNull()
  })
})

describe('runUsageProbe', () => {
  function fakeQuery(usage?: () => Promise<unknown>): {
    q: ProbeQuery
    close: ReturnType<typeof vi.fn>
  } {
    const close = vi.fn()
    const q = {
      close,
      [Symbol.asyncIterator]: (): AsyncIterator<unknown> => ({
        next: async () => ({ done: true, value: undefined })
      }),
      ...(usage ? { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage } : {})
    }
    return { q, close }
  }

  it('llama a la consulta sin persistir la sesión y cierra', async () => {
    const { q, close } = fakeQuery(async () => REAL)
    const factory = vi.fn<ProbeFactory>(() => q)
    await expect(runUsageProbe(factory, { cwd: 'x' })).resolves.toBe(REAL)
    expect(factory.mock.calls[0]?.[0].options).toMatchObject({ persistSession: false, cwd: 'x' })
    expect(close).toHaveBeenCalled()
  })

  it('sin la función, ProbeUnsupported; con error o tiempo límite, cierra igual', async () => {
    const a = fakeQuery()
    await expect(runUsageProbe(() => a.q, {})).rejects.toBeInstanceOf(ProbeUnsupported)
    expect(a.close).toHaveBeenCalled()
    const b = fakeQuery(() => Promise.reject(new Error('fallo')))
    await expect(runUsageProbe(() => b.q, {})).rejects.toThrow('fallo')
    expect(b.close).toHaveBeenCalled()
    const c = fakeQuery(() => new Promise(() => {}))
    await expect(runUsageProbe(() => c.q, {}, 10)).rejects.toThrow('a tiempo')
    expect(c.close).toHaveBeenCalled()
  })
})

describe('LimitsService', () => {
  let now = T0
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    now = T0
  })
  afterEach(() => vi.useRealTimers())

  function service(over: Partial<LimitsDeps> = {}): {
    svc: LimitsService
    emitted: LimitsSnapshot[]
    deps: LimitsDeps
  } {
    const emitted: LimitsSnapshot[] = []
    const deps: LimitsDeps = {
      emit: (s) => emitted.push(s),
      readIndex: () => null,
      chatUsage: () => null,
      probe: vi.fn(async () => REAL),
      probeEnabled: () => true,
      now: () => now,
      ...over
    }
    return { svc: new LimitsService(deps), emitted, deps }
  }
  const estimate = {
    hits: [],
    estimate: { start: '2026-10-15T06:40:00.000Z', end: '2026-10-15T11:40:00.000Z', tokens: 1000 }
  }

  it('la consulta de uso manda sobre la estimación; la estimación queda de respaldo', async () => {
    const { svc } = service({ readIndex: () => estimate })
    svc.fromIndex()
    expect(svc.snapshot().fiveHour).toMatchObject({ source: 'estimate', tokens: 1000 })
    await svc.requestUsage({ allowProbe: true })
    expect(svc.snapshot()).toMatchObject({
      fiveHour: { source: 'sdk-usage', utilization: 54 },
      weekly: { source: 'sdk-usage' },
      subscription: 'pro',
      probe: { state: 'ok' }
    })
  })

  it('el evento del chat manda sobre el aviso en sesión', () => {
    const hit = {
      hits: [
        {
          timestamp: '2026-10-15T08:00:00Z',
          kind: 'five_hour' as const,
          status: 'rejected',
          resetsAt: '2026-10-15T10:00:00.000Z'
        }
      ],
      estimate: null
    }
    const { svc } = service({ readIndex: () => hit })
    svc.fromIndex()
    expect(svc.snapshot().fiveHour).toMatchObject({ source: 'session-hit', status: 'rejected' })
    const w: LimitWindow = {
      kind: 'five_hour',
      utilization: 90,
      status: 'allowed_warning',
      resetsAt: '2026-10-15T10:30:00.000Z',
      source: 'chat-event',
      observedAt: new Date(T0).toISOString()
    }
    svc.fromChatEvent(w)
    expect(svc.snapshot().fiveHour).toMatchObject({ source: 'chat-event', utilization: 90 })
  })

  it('a la hora de renovación cae a la siguiente fuente y emite', async () => {
    const { svc, emitted } = service({ readIndex: () => estimate })
    await svc.requestUsage({ allowProbe: true })
    svc.fromIndex()
    now = Date.parse('2026-10-15T11:40:01Z')
    vi.advanceTimersByTime(now - T0)
    const last = emitted.at(-1)
    expect(last?.fiveHour).toBeNull()
    expect(last?.weekly).toMatchObject({ source: 'sdk-usage' })
  })

  it('respeta los mínimos entre consultas y no reintenta si no está disponible', async () => {
    const probe = vi.fn(async () => ({ rate_limits_available: false }))
    const { svc } = service({ probe })
    await svc.requestUsage({ allowProbe: true })
    expect(svc.snapshot().probe.state).toBe('unavailable')
    now += 10 * 60_000
    await svc.requestUsage({ allowProbe: true, force: true })
    expect(probe).toHaveBeenCalledTimes(1)

    const chat = vi.fn(async () => REAL)
    const other = service({ chatUsage: chat })
    await other.svc.requestUsage({ allowProbe: false })
    await other.svc.requestUsage({ allowProbe: false })
    expect(chat).toHaveBeenCalledTimes(1)
    now += 61_000
    await other.svc.requestUsage({ allowProbe: false })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(other.deps.probe).not.toHaveBeenCalled()
  })

  it('sin sonda permitida y sin chat no consulta; un error queda en el estado', async () => {
    const probe = vi.fn(() => Promise.reject(new Error('sin red')))
    const off = service({ probe, probeEnabled: () => false })
    await off.svc.requestUsage({ allowProbe: true })
    expect(probe).not.toHaveBeenCalled()
    const on = service({ probe })
    await on.svc.requestUsage({ allowProbe: true })
    expect(on.svc.snapshot().probe).toMatchObject({ state: 'error', reason: 'sin red' })
  })

  it('carga la caché sin lo caducado y guarda con retraso', async () => {
    const save = vi.fn()
    const cache: LimitsSnapshot = {
      fiveHour: readUsageResponse(REAL, T0 - 1000) && {
        kind: 'five_hour',
        utilization: 30,
        status: 'allowed',
        resetsAt: '2026-10-15T08:00:00.000Z',
        source: 'sdk-usage',
        observedAt: '2026-10-15T07:00:00.000Z'
      },
      weekly: {
        kind: 'seven_day',
        utilization: 20,
        status: 'allowed',
        resetsAt: '2026-10-20T09:00:00.000Z',
        source: 'sdk-usage',
        observedAt: '2026-10-15T07:00:00.000Z'
      },
      perModel: [],
      subscription: 'pro',
      probe: { state: 'idle' }
    }
    const { svc } = service({ cache, save })
    expect(svc.snapshot().fiveHour).toBeNull()
    expect(svc.snapshot().weekly).toMatchObject({ utilization: 20 })
    await svc.requestUsage({ allowProbe: true })
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(save).toHaveBeenCalledTimes(1)
    // Una caché con otra forma no rompe.
    expect(() => service({ cache: { weird: true } as unknown as LimitsSnapshot })).not.toThrow()
  })
})
