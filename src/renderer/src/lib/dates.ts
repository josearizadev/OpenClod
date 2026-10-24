/**
 * Fechas de la lista de sesiones, en el idioma de la interfaz y con la hora local.
 */

import { t, tag } from '../i18n'

const DAY_MS = 86_400_000

export interface DateGroup<T> {
  label: string
  items: T[]
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Días naturales entre `date` y `now` (0 = hoy, 1 = ayer). Redondea: los cambios de hora no cuentan. */
export function calendarDaysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const monthFormat = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' })

function groupLabel(date: Date, now: Date): string {
  const days = calendarDaysAgo(date, now)
  if (days <= 0) return t('Hoy')
  if (days === 1) return t('Ayer')
  if (days <= 7) return t('Últimos 7 días')
  if (days <= 30) return t('Últimos 30 días')
  return monthFormat.format(date)
}

/**
 * Agrupa por días naturales: Hoy, Ayer, Últimos 7 días (2–7), Últimos 30 días (8–30) y después
 * por mes («septiembre de 2026»). Los elementos sin fecha van a «Sin fecha», al final. Conserva el
 * orden de entrada dentro de cada grupo (la lista llega ordenada por última actividad).
 */
export function groupByDate<T>(
  items: readonly T[],
  now: Date,
  dateOf: (item: T) => string | null | undefined
): DateGroup<T>[] {
  const groups = new Map<string, DateGroup<T>>()
  const undated: T[] = []
  for (const item of items) {
    const date = parse(dateOf(item))
    if (!date) {
      undated.push(item)
      continue
    }
    const label = groupLabel(date, now)
    const group = groups.get(label)
    if (group) group.items.push(item)
    else groups.set(label, { label, items: [item] })
  }
  const out = [...groups.values()]
  if (undated.length > 0) out.push({ label: t('Sin fecha'), items: undated })
  return out
}

// Minutos y horas abreviados («hace 5 min»); días completos («hace 3 días», «ayer»).
const relativeShort = new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'short' })
const relativeLong = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
const shortDate = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' })
const shortDateYear = new Intl.DateTimeFormat(tag, {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

/** «ahora», «hace 5 min», «hace 3 h», «ayer», «hace 3 días»; desde 30 días, fecha corta («12 sept»). */
export function relativeTime(iso: string | null | undefined, now: Date): string {
  const date = parse(iso)
  if (!date) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
  const days = calendarDaysAgo(date, now)
  if (days <= 0) {
    if (seconds < 60) return relativeShort.format(0, 'second')
    if (seconds < 3600) return relativeShort.format(-Math.floor(seconds / 60), 'minute')
    return relativeShort.format(-Math.floor(seconds / 3600), 'hour')
  }
  if (days < 30) return relativeLong.format(-days, 'day')
  return (date.getFullYear() === now.getFullYear() ? shortDate : shortDateYear).format(date)
}

const longDate = new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeStyle: 'short' })

/** «14 de octubre de 2026 a las 11:30» (ficha de la sesión). */
export function longDateTime(iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? longDate.format(date) : '—'
}

const timeFormat = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat(tag, {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})
const dayFormatYear = new Intl.DateTimeFormat(tag, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})
const shortDateTimeFormat = new Intl.DateTimeFormat(tag, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/** «18:04» (hora de un mensaje del visor). */
export function timeOfDay(iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? timeFormat.format(date) : ''
}

/** «martes, 13 de octubre» (separador de fecha); con el año si no es el actual. */
export function dayHeading(iso: string | null | undefined, now: Date): string {
  const date = parse(iso)
  if (!date) return ''
  return (date.getFullYear() === now.getFullYear() ? dayFormat : dayFormatYear).format(date)
}

/** «13 oct, 18:04» («Reanudada aquí»). */
export function shortDateTime(iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? shortDateTimeFormat.format(date) : ''
}

/** «45 s», «2 min 14 s», «1 h 5 min» (duración de un turno). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total} s`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`
}
