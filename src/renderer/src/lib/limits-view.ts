import type { LimitWindow } from '../../../shared/usage'
import { formatAgo, formatClock, formatDuration, formatTokens } from './usage-format'

/** Presentación de una ventana de límite. Pura. */

export type LimitTone = 'normal' | 'warning' | 'danger' | 'empty'

export interface LimitView {
  /** 0–100 si se conoce. */
  pct: number | null
  /** Relleno de la barra 0–1 (porcentaje real o, en estimación, el tiempo transcurrido). */
  fill: number
  tone: LimitTone
  estimate: boolean
  /** «62 %» o «~1,2 M». */
  value: string
  /** «2 h 14 min» hasta la renovación, o ''. */
  remaining: string
  /** «se renueva a las 21:30». */
  resets: string
  /** «Según Claude Code · hace 3 min» / «Estimación local». */
  source: string
  aria: string
}

const NAMES: Record<string, string> = {
  five_hour: 'Límite de 5 horas',
  seven_day: 'Límite semanal',
  seven_day_opus: 'Semanal de Opus',
  seven_day_sonnet: 'Semanal de Sonnet'
}

export function limitName(w: Pick<LimitWindow, 'kind' | 'label'>): string {
  return w.label ? `Semanal de ${w.label}` : (NAMES[w.kind] ?? 'Límite')
}

export function limitView(
  w: LimitWindow | null,
  now = Date.now(),
  name = 'Límite de 5 horas'
): LimitView {
  if (!w) {
    return {
      pct: null,
      fill: 0,
      tone: 'empty',
      estimate: true,
      value: '',
      remaining: '',
      resets: '',
      source: 'Estimación local',
      aria: `${name}: sin bloque activo`
    }
  }
  const estimate = w.source === 'estimate'
  const end = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const left = Number.isFinite(end) ? Math.max(0, end - now) : null
  const pct = w.utilization
  let fill = pct !== null ? pct / 100 : 0
  if (pct === null && estimate && w.startsAt && Number.isFinite(end)) {
    const start = Date.parse(w.startsAt)
    fill = Math.min(1, Math.max(0, (now - start) / (end - start)))
  }
  const tone: LimitTone =
    w.status === 'rejected' || (pct !== null && pct >= 100)
      ? 'danger'
      : w.status === 'allowed_warning' || (pct !== null && pct >= 80)
        ? 'warning'
        : 'normal'
  const value =
    pct !== null
      ? `${Math.round(pct)} %`
      : estimate && w.tokens !== undefined
        ? `~${formatTokens(w.tokens)}`
        : ''
  const remaining = left !== null ? formatDuration(left) : ''
  const resets = w.resetsAt ? `se renueva a las ${formatClock(w.resetsAt, now)}` : ''
  const source = estimate
    ? 'Estimación local'
    : w.source === 'session-hit'
      ? `Aviso de Claude Code · ${formatAgo(w.observedAt, now)}`
      : `Según Claude Code · ${formatAgo(w.observedAt, now)}`
  const parts = [name]
  if (tone === 'danger') parts.push('límite alcanzado')
  else if (pct !== null) parts.push(`${Math.round(pct)} % usado`)
  else if (value) parts.push(`${value} tokens en el bloque (estimación local)`)
  if (remaining) parts.push(`se renueva en ${remaining}`)
  return { pct, fill, tone, estimate, value, remaining, resets, source, aria: parts.join(', ') }
}
