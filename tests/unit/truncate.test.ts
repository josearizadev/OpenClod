import { describe, expect, it } from 'vitest'
import { truncateText } from '../../src/renderer/src/lib/transcript/truncate'

describe('truncateText', () => {
  it('un texto corto no cambia', () => {
    expect(truncateText('a\nb')).toEqual({ head: 'a\nb', totalLines: 2, truncated: false })
    expect(truncateText('')).toEqual({ head: '', totalLines: 1, truncated: false })
  })

  it('límite por líneas', () => {
    const text = Array.from({ length: 50 }, (_, i) => `línea ${i}`).join('\n')
    const out = truncateText(text)
    expect(out.truncated).toBe(true)
    expect(out.totalLines).toBe(50)
    expect(out.head.split('\n')).toHaveLength(20)
    expect(out.head.endsWith('línea 19')).toBe(true)
  })

  it('límite por caracteres: corta en un salto de línea si lo hay', () => {
    const long = 'x'.repeat(3000) + '\n' + 'y'.repeat(3000)
    const out = truncateText(long)
    expect(out).toMatchObject({ head: 'x'.repeat(3000), totalLines: 2, truncated: true })
    const single = 'z'.repeat(10_000)
    expect(truncateText(single).head).toHaveLength(4000)
  })

  it('límites propios', () => {
    expect(truncateText('a\nb\nc', { lines: 2, chars: 100 })).toEqual({
      head: 'a\nb',
      totalLines: 3,
      truncated: true
    })
  })
})
