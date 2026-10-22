/** Formatos de la vista Uso: tokens, duraciones, horas y dinero en español. */

const compact = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('es-ES')
const money = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1.234 → «1,2 k»; 1.234.567 → «1,2 M». */
export function formatTokens(n: number): string {
  if (n >= 1e9) return `${compact.format(n / 1e9)} B`
  if (n >= 1e6) return `${compact.format(n / 1e6)} M`
  if (n >= 1e3) return `${compact.format(n / 1e3)} k`
  return integer.format(Math.round(n))
}

export function formatInteger(n: number): string {
  return integer.format(Math.round(n))
}

/** Milisegundos → «2 h 14 min», «45 min», «< 1 min». */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return '< 1 min'
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) return hours ? `${days} d ${hours} h` : `${days} d`
  if (hours > 0) return rest ? `${hours} h ${rest} min` : `${hours} h`
  return `${rest} min`
}

/** ISO → «21:30», o «lun 21:30» si no es hoy. */
export function formatClock(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (new Date(now).toDateString() === d.toDateString()) return time
  return `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })} ${time}`
}

/** «12,30 $». */
export function formatUsd(n: number): string {
  return `${money.format(n)} $`
}

/** Hace cuánto: «hace 3 min», «ahora». */
export function formatAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso)
  return ms < 60_000 ? 'ahora' : `hace ${formatDuration(ms)}`
}

/** YYYY-MM-DD → «15 oct». */
export function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
