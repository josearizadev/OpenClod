import { describe, expect, it } from 'vitest'
import { InputQueue } from '../../src/main/services/chat/input-queue'

async function take<T>(it: AsyncIterator<T>, n: number): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < n; i++) {
    const next = await it.next()
    if (next.done) break
    out.push(next.value)
  }
  return out
}

describe('InputQueue', () => {
  it('entrega en orden lo que ya había y lo que llega después', async () => {
    const queue = new InputQueue<number>()
    queue.push(1)
    queue.push(2)
    const it = queue[Symbol.asyncIterator]()
    expect(await take(it, 2)).toEqual([1, 2])
    const later = it.next()
    queue.push(3)
    expect(await later).toEqual({ done: false, value: 3 })
  })

  it('espera sin consumir hasta que hay algo', async () => {
    const queue = new InputQueue<string>()
    const it = queue[Symbol.asyncIterator]()
    let settled = false
    const next = it.next().then((r) => {
      settled = true
      return r
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    queue.push('hola')
    expect(await next).toEqual({ done: false, value: 'hola' })
  })

  it('close termina el iterador tras entregar lo pendiente e ignora lo posterior', async () => {
    const queue = new InputQueue<number>()
    queue.push(1)
    queue.close()
    queue.push(2)
    expect(queue.closed).toBe(true)
    const seen: number[] = []
    for await (const n of queue) seen.push(n)
    expect(seen).toEqual([1])
  })

  it('close despierta a quien espera', async () => {
    const queue = new InputQueue<number>()
    const it = queue[Symbol.asyncIterator]()
    const next = it.next()
    queue.close()
    expect(await next).toEqual({ done: true, value: undefined })
  })
})
