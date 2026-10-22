import { describe, expect, it } from 'vitest'
import {
  calendarDaysAgo,
  dayHeading,
  formatDuration,
  shortDateTime,
  timeOfDay,
  groupByDate,
  longDateTime,
  relativeTime
} from '../../src/renderer/src/lib/dates'

/** Fechas en hora local: los tests no dependen de la zona horaria del equipo. */
const at = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)
const iso = (date: Date): string => date.toISOString()

describe('calendarDaysAgo', () => {
  it('cuenta días naturales, no 24 h', () => {
    const now = at(2026, 10, 14, 0, 5)
    expect(calendarDaysAgo(at(2026, 10, 13, 23, 59), now)).toBe(1)
    expect(calendarDaysAgo(at(2026, 10, 14, 0, 0), now)).toBe(0)
    expect(calendarDaysAgo(at(2026, 9, 30), at(2026, 10, 1))).toBe(1)
    expect(calendarDaysAgo(at(2025, 12, 31), at(2026, 1, 1))).toBe(1)
  })
})

describe('groupByDate', () => {
  const now = at(2026, 10, 14, 9)
  const label = (date: Date | null): string =>
    groupByDate([{ d: date ? iso(date) : undefined }], now, (x) => x.d)[0]?.label ?? ''

  it('límites de Hoy, Ayer, 7 y 30 días', () => {
    expect(label(at(2026, 10, 14, 0, 0))).toBe('Hoy')
    expect(label(at(2026, 10, 13, 23, 59))).toBe('Ayer')
    expect(label(at(2026, 10, 12))).toBe('Últimos 7 días') // 2 días
    expect(label(at(2026, 10, 7))).toBe('Últimos 7 días') // 7
    expect(label(at(2026, 10, 6))).toBe('Últimos 30 días') // 8
    expect(label(at(2026, 9, 14))).toBe('Últimos 30 días') // 30
    expect(label(at(2026, 9, 13))).toBe('septiembre de 2026') // 31
  })

  it('después, por mes en español, también con cambio de año', () => {
    expect(label(at(2026, 8, 2))).toBe('agosto de 2026')
    expect(label(at(2025, 12, 31))).toBe('diciembre de 2025')
    const jan = at(2026, 1, 2, 9)
    expect(groupByDate([{ d: iso(at(2025, 12, 31)) }], jan, (x) => x.d)[0]?.label).toBe(
      'Últimos 7 días'
    )
  })

  it('una fecha futura (otro reloj) cuenta como hoy', () => {
    expect(label(at(2026, 10, 15))).toBe('Hoy')
  })

  it('agrupa conservando el orden y deja «Sin fecha» al final', () => {
    const items = [
      { id: 'a', d: iso(at(2026, 10, 14, 8)) },
      { id: 'x', d: undefined },
      { id: 'b', d: iso(at(2026, 10, 14, 7)) },
      { id: 'c', d: iso(at(2026, 10, 13)) },
      { id: 'y', d: 'no es fecha' },
      { id: 'e', d: iso(at(2026, 7, 1)) }
    ]
    const groups = groupByDate(items, now, (x) => x.d)
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id).join('')])).toEqual([
      ['Hoy', 'ab'],
      ['Ayer', 'c'],
      ['julio de 2026', 'e'],
      ['Sin fecha', 'xy']
    ])
    expect(groupByDate([], now, () => null)).toEqual([])
  })
})

describe('relativeTime', () => {
  const now = at(2026, 10, 14, 12, 0)
  it('minutos, horas, ayer, días y fecha corta', () => {
    expect(relativeTime(iso(at(2026, 10, 14, 11, 59)), now)).toBe('hace 1 min')
    expect(relativeTime(iso(new Date(now.getTime() - 20_000)), now)).toBe('ahora')
    expect(relativeTime(iso(at(2026, 10, 14, 11, 55)), now)).toBe('hace 5 min')
    expect(relativeTime(iso(at(2026, 10, 14, 9, 0)), now)).toBe('hace 3 h')
    expect(relativeTime(iso(at(2026, 10, 13, 23, 0)), now)).toBe('ayer')
    expect(relativeTime(iso(at(2026, 10, 11)), now)).toBe('hace 3 días')
    expect(relativeTime(iso(at(2026, 9, 15)), now)).toBe('hace 29 días')
    expect(relativeTime(iso(at(2026, 9, 12)), now)).toBe('12 sept')
    expect(relativeTime(iso(at(2025, 9, 12)), now)).toBe('12 sept 2025')
  })

  it('sin fecha o no válida → cadena vacía', () => {
    expect(relativeTime(undefined, now)).toBe('')
    expect(relativeTime('x', now)).toBe('')
    expect(longDateTime(undefined)).toBe('—')
  })

  it('formato largo de la ficha', () => {
    expect(longDateTime(iso(at(2026, 10, 14, 11, 30)))).toBe('14 de octubre de 2026 a las 11:30')
  })
})

describe('fechas del visor', () => {
  it('formatDuration', () => {
    expect(formatDuration(800)).toBe('1 s')
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(134_000)).toBe('2 min 14 s')
    expect(formatDuration(120_000)).toBe('2 min')
    expect(formatDuration(3_900_000)).toBe('1 h 5 min')
    expect(formatDuration(7_200_000)).toBe('2 h')
  })

  it('timeOfDay, dayHeading y shortDateTime', () => {
    const iso = new Date(2026, 9, 13, 18, 4).toISOString()
    expect(timeOfDay(iso)).toBe('18:04')
    expect(dayHeading(iso, new Date(2026, 9, 14))).toBe('martes, 13 de octubre')
    expect(dayHeading(iso, new Date(2027, 0, 2))).toBe('martes, 13 de octubre de 2026')
    expect(shortDateTime(iso)).toMatch(/^13 oct\.?, 18:04$/)
    expect(timeOfDay(undefined)).toBe('')
    expect(dayHeading('no', new Date())).toBe('')
  })
})
