import { describe, expect, it } from 'vitest'
import {
  formatNumber,
  formatTokens,
  tokenBreakdown,
  totalTokens
} from '../../src/renderer/src/lib/tokens'

/** Intl separa número y unidad con espacio duro: se normaliza para comparar. */
const plain = (s: string): string => s.replace(/\u00a0/g, ' ')

describe('tokens', () => {
  it('total = suma de los cuatro contadores', () => {
    expect(totalTokens({ input: 1, output: 2, cacheCreation: 3, cacheRead: 4 })).toBe(10)
  })

  it('formato compacto es-ES', () => {
    expect(plain(formatTokens(1_234_567))).toBe('1,2 M')
    expect(plain(formatTokens(850_000))).toBe('850 mil')
    expect(plain(formatTokens(12_400))).toBe('12,4 mil')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(0)).toBe('0')
  })

  it('desglose con separador de miles', () => {
    expect(formatNumber(1234)).toBe('1.234')
    expect(formatNumber(47_904_907)).toBe('47.904.907')
    expect(
      tokenBreakdown({ input: 502, output: 329810, cacheCreation: 859933, cacheRead: 1 })
    ).toEqual([
      { label: 'Entrada', value: '502' },
      { label: 'Salida', value: '329.810' },
      { label: 'Creación de caché', value: '859.933' },
      { label: 'Lectura de caché', value: '1' },
      { label: 'Total', value: '1.190.246' }
    ])
  })
})
