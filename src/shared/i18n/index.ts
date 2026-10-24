import { z } from 'zod'
import { en } from './en'

/**
 * Traducción de la interfaz. El texto en español es la clave y `en.ts` guarda su traducción:
 * `t('Nueva sesión')` devuelve «Nueva sesión» o «New session». La clave se tipa con las de `en`,
 * así que un texto sin traducir no compila. `{nombre}` se sustituye por el parámetro del mismo
 * nombre; los números se formatean según el idioma.
 */

export const LocaleSchema = z.enum(['es', 'en'])
export type Locale = z.infer<typeof LocaleSchema>

/** Ajuste de idioma: `system` sigue el idioma del sistema operativo. */
export const LanguageSchema = z.enum(['system', 'es', 'en'])
export type Language = z.infer<typeof LanguageSchema>

export type MessageKey = keyof typeof en
export type MessageParams = Record<string, string | number>

const TAGS: Record<Locale, string> = { es: 'es-ES', en: 'en-US' }

/** Etiqueta BCP 47 para `Intl` y `toLocale…`. */
export function localeTag(locale: Locale): string {
  return TAGS[locale]
}

const numberFormats = new Map<Locale, Intl.NumberFormat>()
function formatNumber(locale: Locale, value: number): string {
  let format = numberFormats.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(TAGS[locale])
    numberFormats.set(locale, format)
  }
  return format.format(value)
}

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const text: string = locale === 'en' ? en[key] : key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    if (value === undefined) return match
    return typeof value === 'number' ? formatNumber(locale, value) : value
  })
}

/**
 * Idioma efectivo: el elegido o, con `system`, el primero de los preferidos del sistema que sea
 * español o inglés. Si no hay ninguno, inglés.
 */
export function resolveLocale(language: Language, preferred: readonly string[]): Locale {
  if (language !== 'system') return language
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0]
    if (base === 'es' || base === 'en') return base
  }
  return 'en'
}
