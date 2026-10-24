import {
  localeTag,
  translate,
  type Locale,
  type MessageKey,
  type MessageParams
} from '../../shared/i18n'

/**
 * Idioma del renderer: lo fija el preload al cargar la ventana y no cambia sin recargarla. Así
 * los formateadores `Intl` de módulo y los textos ya calculados no necesitan reactividad. Fuera
 * de Electron (tests), español.
 */
function initialLocale(): Locale {
  const fromPreload =
    typeof window !== 'undefined'
      ? (window as { api?: { locale?: string } }).api?.locale
      : undefined
  return fromPreload === 'en' ? 'en' : 'es'
}

export const locale: Locale = initialLocale()
/** Etiqueta para `Intl` («es-ES», «en-US»). */
export const tag = localeTag(locale)

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale, key, params)
}
