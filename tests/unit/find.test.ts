import { describe, expect, it } from 'vitest'
import { findInItems, hitId } from '../../src/renderer/src/lib/transcript/find'
import type { TranscriptItem } from '../../src/shared/sessions'

const base = { sidechain: false }
const items: TranscriptItem[] = [
  { ...base, line: 1, uuid: 'u1', kind: 'user-prompt', text: 'Arregla la BÚSQUEDA', images: 0 },
  { ...base, line: 2, uuid: 'a1', kind: 'thinking', text: 'busqueda y busqueda' },
  {
    ...base,
    line: 3,
    uuid: 'a2',
    kind: 'tool-use',
    id: 't1',
    name: 'Grep',
    input: { q: 'busqueda' }
  },
  {
    ...base,
    line: 4,
    uuid: 'r1',
    kind: 'tool-result',
    toolUseId: 't1',
    isError: false,
    text: 'src/búsqueda.ts'
  },
  { ...base, line: 5, uuid: 'a3', kind: 'assistant-text', text: 'Hecho: la búsqueda funciona' },
  { ...base, line: 6, kind: 'meta', text: 'busqueda interna' }
]

describe('findInItems', () => {
  it('campos, mayúsculas y tildes; la entrada de herramientas no cuenta', () => {
    const hits = findInItems(items, 'Búsqueda')
    expect(hits.map((h) => [h.field, h.ordinal])).toEqual([
      ['prompt', 0],
      ['thinking', 0],
      ['thinking', 1],
      ['tool-output', 0],
      ['text', 0]
    ])
    expect(hits[3]?.toolUseId).toBe('t1')
    expect(findInItems(items, '   ')).toEqual([])
    expect(findInItems(items, 'nada')).toEqual([])
  })

  it('estable al añadir elementos', () => {
    const before = findInItems(items, 'busqueda').map(hitId)
    const grown = [
      ...items,
      {
        ...base,
        line: 7,
        uuid: 'u2',
        kind: 'user-prompt' as const,
        text: 'otra búsqueda',
        images: 0
      }
    ]
    const after = findInItems(grown, 'busqueda').map(hitId)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after).toHaveLength(before.length + 1)
  })
})
