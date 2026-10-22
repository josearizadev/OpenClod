import { describe, expect, it } from 'vitest'
import { limitView } from '../../src/renderer/src/lib/limits-view'
import { formatDuration, formatTokens, formatUsd } from '../../src/renderer/src/lib/usage-format'
import type { LimitWindow } from '../../src/shared/usage'

describe('usage-format', () => {
  it('tokens compactos en español', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1234)).toBe('1,2 k')
    expect(formatTokens(1_234_567)).toBe('1,2 M')
    expect(formatTokens(1_320_367_400)).toBe('1,3 B')
  })

  it('duraciones', () => {
    expect(formatDuration(30_000)).toBe('< 1 min')
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(134 * 60_000)).toBe('2 h 14 min')
    expect(formatDuration(120 * 60_000)).toBe('2 h')
    expect(formatDuration(26 * 3_600_000)).toBe('1 d 2 h')
  })

  it('dinero', () => {
    expect(formatUsd(12.3)).toBe('12,30 $')
  })
})

describe('limitView', () => {
  const NOW = Date.parse('2026-10-15T09:26:00Z')
  const base: LimitWindow = {
    kind: 'five_hour',
    utilization: 62,
    status: 'allowed',
    resetsAt: '2026-10-15T11:40:00.000Z',
    source: 'sdk-usage',
    observedAt: '2026-10-15T09:23:00.000Z'
  }

  it('dato real: porcentaje, cuenta atrás y origen', () => {
    const v = limitView(base, NOW)
    expect(v).toMatchObject({
      pct: 62,
      tone: 'normal',
      estimate: false,
      value: '62 %',
      remaining: '2 h 14 min'
    })
    expect(v.source).toBe('Según Claude Code · hace 3 min')
    expect(v.aria).toBe('Límite de 5 horas, 62 % usado, se renueva en 2 h 14 min')
  })

  it('umbrales de aviso y límite', () => {
    expect(limitView({ ...base, utilization: 80 }, NOW).tone).toBe('warning')
    expect(limitView({ ...base, utilization: 10, status: 'allowed_warning' }, NOW).tone).toBe(
      'warning'
    )
    expect(limitView({ ...base, status: 'rejected' }, NOW).tone).toBe('danger')
    expect(limitView({ ...base, utilization: 100 }, NOW).tone).toBe('danger')
  })

  it('estimación: sin porcentaje, con «~» y relleno por tiempo', () => {
    const v = limitView(
      {
        ...base,
        utilization: null,
        status: 'unknown',
        source: 'estimate',
        startsAt: '2026-10-15T06:40:00.000Z',
        tokens: 1_200_000
      },
      NOW
    )
    expect(v).toMatchObject({
      pct: null,
      estimate: true,
      value: '~1,2 M',
      source: 'Estimación local'
    })
    expect(v.fill).toBeCloseTo(166 / 300, 2)
  })

  it('sin ventana: vacío', () => {
    expect(limitView(null, NOW)).toMatchObject({
      tone: 'empty',
      aria: 'Límite de 5 horas: sin bloque activo'
    })
  })
})
