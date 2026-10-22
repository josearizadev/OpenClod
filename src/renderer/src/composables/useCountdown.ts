import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * Reloj para cuentas atrás: un solo `setTimeout` al siguiente cambio de
 * minuto (mínimo 30 s) o al objetivo; se detiene si no hay objetivo.
 */
export function useCountdown(target: () => string | null | undefined): Ref<number> {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setTimeout> | null = null

  function tick(): void {
    if (timer) clearTimeout(timer)
    timer = null
    now.value = Date.now()
    const iso = target()
    const end = iso ? Date.parse(iso) : NaN
    if (!Number.isFinite(end) || end <= now.value) return
    const toMinute = 60_000 - (now.value % 60_000)
    const delay = Math.min(end - now.value + 50, Math.max(30_000, toMinute))
    timer = setTimeout(tick, delay)
  }

  watch(target, tick, { immediate: true })
  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })
  return now
}
