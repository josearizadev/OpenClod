import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { nextExpiry } from '../lib/live'

/**
 * Reloj para la marca «en vivo»: se pone al día cuando cambian las fechas y
 * programa un solo `setTimeout` al siguiente vencimiento. Sin intervalos fijos.
 */
export function useLiveClock(times: () => readonly (number | undefined)[]): Ref<number> {
  const clock = ref(Date.now())
  let timer: ReturnType<typeof setTimeout> | null = null

  function tick(): void {
    if (timer) clearTimeout(timer)
    timer = null
    clock.value = Date.now()
    const next = nextExpiry(times(), clock.value)
    if (next !== null) timer = setTimeout(tick, next - clock.value + 50)
  }

  watch(times, tick, { immediate: true })
  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })
  return clock
}
