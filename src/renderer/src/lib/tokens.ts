import type { TokenUsage } from '../../../shared/sessions'
import { t, tag } from '../i18n'

/** Cifras de tokens. */

/** Total de la lista: suma de los cuatro contadores. */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheCreation + u.cacheRead
}

const compact = new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat(tag, { useGrouping: 'always' })

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
    { label: t('Entrada'), value: formatNumber(u.input) },
    { label: t('Salida'), value: formatNumber(u.output) },
    { label: t('Creación de caché'), value: formatNumber(u.cacheCreation) },
    { label: t('Lectura de caché'), value: formatNumber(u.cacheRead) },
    { label: t('Total'), value: formatNumber(totalTokens(u)) }
  ]
}
