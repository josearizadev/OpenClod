import { describe, expect, it } from 'vitest'
import {
  archivedCount,
  groupFolders,
  groupSessions
} from '../../src/renderer/src/lib/sessions-groups'
import type { SessionListItem } from '../../src/shared/projects'
import type { SessionFolder } from '../../src/shared/types'

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

  it('con «Archivadas», las archivadas salen juntas al final, también las favoritas', () => {
    expect(shape(groupSessions(list, now, true))).toEqual([
      ['Favoritas', ['fav-hoy', 'fav-vieja']],
      ['Hoy', ['hoy']],
      ['Ayer', ['ayer']],
      ['septiembre de 2026', ['vieja']],
      ['Archivadas', ['oculta', 'fav-oculta']]
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

  it('archivedCount', () => {
    expect(archivedCount(list)).toBe(2)
  })
})

describe('carpetas', () => {
  const folder = (id: string, createdAt: string): SessionFolder => ({
    id,
    projectId: '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f',
    name: id,
    context: '',
    createdAt
  })
  const a = folder('a', '2026-01-01T00:00:00.000Z')
  const b = folder('b', '2026-10-14T11:00:00.000Z')
  const c = folder('c', '2026-10-01T00:00:00.000Z')
  const withFolders = [
    item('hoy', 0),
    item('en-a-vieja', 40, { folderId: 'a' }),
    item('en-a-ayer', 1, { folderId: 'a', favorite: true }),
    item('en-a-archivada', 0, { folderId: 'a', hidden: true }),
    item('carpeta-borrada', 0, { folderId: 'zzz' })
  ]

  it('las sesiones de una carpeta solo salen en ella, también si son favoritas', () => {
    expect(shape(groupSessions(withFolders, now, true, [a, b, c]))).toEqual([
      ['Hoy', ['hoy', 'carpeta-borrada']],
      ['Archivadas', ['en-a-archivada']]
    ])
  })

  it('carpetas por actividad (vacías por creación) y sesiones por fecha, sin archivadas', () => {
    const groups = groupFolders(withFolders, [a, b, c])
    expect(groups.map((g) => [g.folder.id, g.items.map((i) => i.sessionId)])).toEqual([
      ['b', []],
      ['a', ['en-a-ayer', 'en-a-vieja']],
      ['c', []]
    ])
  })
})
