import { describe, expect, it } from 'vitest'
import { addUsage, maxUsage, readUsage, UsageLedger, usageKey } from '../../src/main/services/usage'
import type { UsageEvent } from '../../src/shared/sessions'

function event(key: string, input: number, output: number): UsageEvent {
  return { key, model: 'claude-opus-5-5', usage: { input, output, cacheCreation: 0, cacheRead: 0 } }
}

describe('usageKey', () => {
  it('combina message.id y requestId', () => {
    expect(usageKey('msg_1', 'req_1', 'claude-opus-5-5')).toBe('msg_1:req_1')
    expect(usageKey('msg_1', undefined, 'claude-opus-5-5')).toBe('msg_1:')
  })

  it('excluye los mensajes sin id y los <synthetic>', () => {
    expect(usageKey(undefined, 'req_1', 'claude-opus-5-5')).toBeNull()
    expect(usageKey('', 'req_1', 'claude-opus-5-5')).toBeNull()
    expect(usageKey('msg_1', 'req_1', '<synthetic>')).toBeNull()
  })
})

describe('readUsage', () => {
  it('traduce los campos de la API y trata lo que falte o no sea número como 0', () => {
    expect(
      readUsage({
        input_tokens: 2,
        output_tokens: 8,
        cache_creation_input_tokens: 7139,
        cache_read_input_tokens: 68857,
        service_tier: 'standard'
      })
    ).toEqual({ input: 2, output: 8, cacheCreation: 7139, cacheRead: 68857 })
    expect(readUsage({ input_tokens: '5', output_tokens: -1 })).toEqual({
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0
    })
    expect(readUsage(null)).toEqual({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 })
  })
})

describe('maxUsage / addUsage', () => {
  it('máximo y suma campo a campo', () => {
    const a = { input: 1, output: 10, cacheCreation: 5, cacheRead: 0 }
    const b = { input: 2, output: 3, cacheCreation: 5, cacheRead: 7 }
    expect(maxUsage(a, b)).toEqual({ input: 2, output: 10, cacheCreation: 5, cacheRead: 7 })
    expect(addUsage(a, b)).toEqual({ input: 3, output: 13, cacheCreation: 10, cacheRead: 7 })
  })
})

describe('UsageLedger', () => {
  it('cuenta una vez cada clave tomando el máximo', () => {
    const ledger = new UsageLedger()
    ledger.add([event('m1:r1', 2, 8), event('m1:r1', 2, 4297), event('m2:r2', 1, 1)])
    ledger.add([event('m1:r1', 2, 4297)]) // otra copia (sesión continuada)
    expect(ledger.size).toBe(2)
    expect(ledger.total()).toEqual({ input: 3, output: 4298, cacheCreation: 0, cacheRead: 0 })
  })

  it('no modifica los eventos que recibe', () => {
    const original = event('m1:r1', 1, 1)
    const ledger = new UsageLedger()
    ledger.add([original])
    ledger.add([event('m1:r1', 9, 9)])
    expect(original.usage.input).toBe(1)
  })
})
