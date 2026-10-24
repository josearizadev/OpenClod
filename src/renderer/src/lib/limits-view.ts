import type { LimitWindow } from '../../../shared/usage'
import { formatAgo, formatClock, formatDuration, formatTokens } from './usage-format'
import { t } from '../i18n'

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
  five_hour: t('Límite de 5 horas'),
  seven_day: t('Límite semanal'),
  seven_day_opus: t('Semanal de {model}', { model: 'Opus' }),
  seven_day_sonnet: t('Semanal de {model}', { model: 'Sonnet' })
}

export function limitName(w: Pick<LimitWindow, 'kind' | 'label'>): string {
  return w.label ? t('Semanal de {model}', { model: w.label }) : (NAMES[w.kind] ?? t('Límite'))
}

export function limitView(
  w: LimitWindow | null,
  now = Date.now(),
  name = t('Límite de 5 horas')
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
      source: t('Estimación local'),
      aria: `${name}: ${t('sin bloque activo')}`
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
  const resets = w.resetsAt
    ? t('se renueva a las {time}', { time: formatClock(w.resetsAt, now) })
    : ''
  const source = estimate
    ? t('Estimación local')
    : w.source === 'session-hit'
      ? t('Aviso de Claude Code · {ago}', { ago: formatAgo(w.observedAt, now) })
      : t('Según Claude Code · {ago}', { ago: formatAgo(w.observedAt, now) })
  const parts = [name]
  if (tone === 'danger') parts.push(t('límite alcanzado'))
  else if (pct !== null) parts.push(t('{pct} % usado', { pct: Math.round(pct) }))
  else if (value) parts.push(t('{value} tokens en el bloque (estimación local)', { value }))
  if (remaining) parts.push(t('se renueva en {time}', { time: remaining }))
  return { pct, fill, tone, estimate, value, remaining, resets, source, aria: parts.join(', ') }
}
