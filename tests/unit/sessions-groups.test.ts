import { describe, expect, it } from 'vitest'
import { groupSessions, hiddenCount } from '../../src/renderer/src/lib/sessions-groups'
import type { SessionListItem } from '../../src/shared/projects'

const now = new Date(2026, 9, 14, 12, 0)
const usage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }

function item(
  sessionId: string,
  daysAgo: number,
  extra: Partial<SessionListItem> = {}
): SessionListItem {
  const date = new Date(now)
  date.setDate(date.getDate() - daysAgo)
  return {
    sessionId,
    title: sessionId,
    updatedAt: date.toISOString(),
    usage,
    chainLength: 1,
    favorite: false,
    hidden: false,
    ...extra
  }
}

const list = [
  item('hoy', 0),
  item('fav-hoy', 0, { favorite: true }),
  item('oculta', 0, { hidden: true }),
  item('ayer', 1),
  item('fav-vieja', 40, { favorite: true }),
  item('fav-oculta', 2, { favorite: true, hidden: true }),
  item('vieja', 40)
]

const shape = (groups: ReturnType<typeof groupSessions>): [string, string[]][] =>
  groups.map((g) => [g.label, g.items.map((i) => i.sessionId)])

describe('groupSessions', () => {
  it('«Favoritas» primero, en el orden de la lista, y fuera de los grupos por fecha', () => {
    expect(shape(groupSessions(list, now, false))).toEqual([
      ['Favoritas', ['fav-hoy', 'fav-vieja']],
      ['Hoy', ['hoy']],
      ['Ayer', ['ayer']],
      ['septiembre de 2026', ['vieja']]
    ])
  })

  it('con «Mostrar ocultas», las ocultas salen en su sitio', () => {
    expect(shape(groupSessions(list, now, true))).toEqual([
      ['Favoritas', ['fav-hoy', 'fav-vieja', 'fav-oculta']],
      ['Hoy', ['hoy', 'oculta']],
      ['Ayer', ['ayer']],
      ['septiembre de 2026', ['vieja']]
    ])
  })

  it('sin favoritas, los grupos por fecha tal cual', () => {
    const plain = [item('a', 0), item('b', 5)]
    expect(shape(groupSessions(plain, now, false))).toEqual([
      ['Hoy', ['a']],
      ['Últimos 7 días', ['b']]
    ])
    expect(groupSessions([], now, true)).toEqual([])
  })

  it('hiddenCount', () => {
    expect(hiddenCount(list)).toBe(2)
  })
})
