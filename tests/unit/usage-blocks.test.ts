import { describe, expect, it } from 'vitest'
import {
  ALIGN_MS,
  BLOCK_MS,
  ccusageBlocks,
  currentBlockInfo,
  type BlockEvent
} from '../../src/main/services/usage-blocks'

const at = (iso: string): number => Date.parse(iso)
const ev = (iso: string, tokens = 100, model = 'claude-opus-5-5'): BlockEvent => ({
  t: at(iso),
  model,
  usage: { input: 0, output: tokens, cacheCreation: 0, cacheRead: 0 }
})

describe('ccusageBlocks', () => {
  it('alinea el inicio a 10 min y dura 5 h', () => {
    const [block] = ccusageBlocks.blocks(
      [ev('2026-10-15T06:48:19Z')],
      [],
      at('2026-10-15T07:00:00Z')
    )
    expect(block).toMatchObject({
      start: '2026-10-15T06:40:00.000Z',
      end: '2026-10-15T11:40:00.000Z',
      active: true,
      anchored: false,
      tokens: 100,
      messages: 1
    })
    expect(ALIGN_MS).toBe(10 * 60 * 1000)
    expect(BLOCK_MS).toBe(5 * 60 * 60 * 1000)
  })

  it('el mensaje en el borde exacto abre un bloque nuevo; un hueco largo también', () => {
    const blocks = ccusageBlocks.blocks(
      [
        ev('2026-10-14T10:00:00Z'),
        ev('2026-10-14T14:59:59Z'),
        ev('2026-10-14T15:00:00Z'),
        ev('2026-10-15T09:05:00Z')
      ],
      [],
      at('2026-10-16T00:00:00Z')
    )
    expect(blocks.map((b) => [b.start.slice(11, 16), b.messages])).toEqual([
      ['10:00', 2],
      ['15:00', 1],
      ['09:00', 1]
    ])
    expect(blocks.every((b) => !b.active)).toBe(true)
  })

  it('se ancla a una renovación real y marca el aviso de límite', () => {
    const blocks = ccusageBlocks.blocks(
      [ev('2026-10-14T11:21:08Z'), ev('2026-10-14T14:34:00Z'), ev('2026-10-14T16:20:03Z')],
      [
        { t: at('2026-10-14T14:34:32Z'), resetsAt: at('2026-10-14T16:20:00Z') },
        { t: at('2026-10-14T16:39:04Z'), resetsAt: at('2026-10-14T19:30:00Z') }
      ],
      at('2026-10-14T17:00:00Z')
    )
    expect(blocks.map((b) => [b.start, b.end, b.anchored, b.limitHit, b.active])).toEqual([
      ['2026-10-14T11:20:00.000Z', '2026-10-14T16:20:00.000Z', true, true, false],
      // Avisos solapados (observado el 14-10): el siguiente bloque toma la otra renovación.
      ['2026-10-14T14:30:00.000Z', '2026-10-14T19:30:00.000Z', true, true, true]
    ])
  })
})

describe('currentBlockInfo', () => {
  it('ritmo de los últimos 30 min, proyección y referencia de 30 días', () => {
    const now = at('2026-10-15T08:00:00Z')
    const events = [
      ev('2026-10-14T06:00:00Z', 5000),
      ev('2026-10-15T07:00:00Z', 1000),
      ev('2026-10-15T07:45:00Z', 300)
    ]
    const blocks = ccusageBlocks.blocks(events, [], now)
    const info = currentBlockInfo(blocks, events, now)
    expect(info.block?.tokens).toBe(1300)
    expect(info.ratePerMin).toBe(10)
    // Quedan 4 h (fin a las 12:00) → 1300 + 10 × 240.
    expect(info.projected).toBe(3700)
    expect(info.referenceMax).toBe(5000)
  })

  it('sin bloque activo no hay ritmo ni proyección', () => {
    const events = [ev('2026-10-14T06:00:00Z')]
    const now = at('2026-10-15T08:00:00Z')
    const info = currentBlockInfo(ccusageBlocks.blocks(events, [], now), events, now)
    expect(info).toMatchObject({ block: null, ratePerMin: 0, projected: null })
  })
})
