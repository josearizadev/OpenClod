import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLive, LIVE_MS, nextExpiry } from '../../src/renderer/src/lib/live'
import { useLiveClock } from '../../src/renderer/src/composables/useLiveClock'

afterEach(() => {
  vi.useRealTimers()
})

describe('en vivo', () => {
  it('isLive y nextExpiry', () => {
    const now = 1_000_000
    expect(isLive(now - 1000, now)).toBe(true)
    expect(isLive(now - LIVE_MS, now)).toBe(false)
    expect(isLive(undefined, now)).toBe(false)
    expect(nextExpiry([now - 5000, now - 1000, undefined, now - LIVE_MS - 1], now)).toBe(
      now - 5000 + LIVE_MS
    )
    expect(nextExpiry([now - LIVE_MS - 1], now)).toBeNull()
  })

  it('la marca cae a los 120 s sin pasada nueva', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const times = ref<number[]>([Date.now() - 10_000])
    const scope = effectScope()
    const clock = scope.run(() => useLiveClock(() => times.value))!
    expect(isLive(times.value[0], clock.value)).toBe(true)
    vi.advanceTimersByTime(LIVE_MS - 10_000 - 100)
    expect(isLive(times.value[0], clock.value)).toBe(true)
    vi.advanceTimersByTime(200)
    expect(isLive(times.value[0], clock.value)).toBe(false)
    // Una pasada nueva vuelve a encenderla.
    times.value = [Date.now()]
    await nextTick()
    expect(isLive(times.value[0], clock.value)).toBe(true)
    scope.stop()
  })
})
