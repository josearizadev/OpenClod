import type { TokenUsage } from '../../../shared/sessions'

/** Cifras de tokens. */

/** Total de la lista: suma de los cuatro contadores. */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheCreation + u.cacheRead
}

const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('es-ES', { useGrouping: 'always' })

/** «1,2 M», «850 mil», «12». */
export function formatTokens(n: number): string {
  return compact.format(n)
}

/** Con separador de miles: «1.234.567». */
export function formatNumber(n: number): string {
  return full.format(n)
}

export interface TokenRow {
  label: string
  value: string
}

/** Desglose para el tooltip y la ficha. */
export function tokenBreakdown(u: TokenUsage): TokenRow[] {
  return [
    { label: 'Entrada', value: formatNumber(u.input) },
    { label: 'Salida', value: formatNumber(u.output) },
    { label: 'Creación de caché', value: formatNumber(u.cacheCreation) },
    { label: 'Lectura de caché', value: formatNumber(u.cacheRead) },
    { label: 'Total', value: formatNumber(totalTokens(u)) }
  ]
}
