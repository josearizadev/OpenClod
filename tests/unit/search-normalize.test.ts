import { describe, expect, it } from 'vitest'
import { normalizeForSearch, normalizeWithMap } from '../../src/shared/search'

describe('normalización con mapa', () => {
  it('tildes descompuestas: las posiciones apuntan al original', () => {
    const original = 'Café y CAFÉ'
    const { text, map } = normalizeWithMap(original)
    expect(text).toBe('cafe y cafe')
    const at = text.indexOf('cafe', 1)
    expect(original.slice(map[at], map[at + 4])).toBe('CAFÉ')
    // La primera abarca la marca combinante.
    expect(original.slice(map[0], map[4])).toBe('Café')
    expect(normalizeForSearch('Ñandú')).toBe('nandu')
  })

  it('emojis y pares sustitutos', () => {
    const original = '😀 búsqueda'
    const { text, map } = normalizeWithMap(original)
    const at = text.indexOf('busqueda')
    expect(original.slice(map[at], map[at + 8])).toBe('búsqueda')
  })
})
