/**
 * «En vivo»: una sesión escrita hace menos de 2 min. Puro: el reloj y el
 * temporizador los pone `useLiveClock`.
 */
export const LIVE_MS = 120_000

export function isLive(lastWriteAt: number | undefined, now: number): boolean {
  return lastWriteAt !== undefined && lastWriteAt > now - LIVE_MS && lastWriteAt <= now + LIVE_MS
}

/** Momento en que caduca la primera marca aún viva, o `null` si no hay ninguna. */
export function nextExpiry(times: readonly (number | undefined)[], now: number): number | null {
  let next: number | null = null
  for (const t of times) {
    if (!isLive(t, now)) continue
    const expires = (t as number) + LIVE_MS
    if (next === null || expires < next) next = expires
  }
  return next
}
