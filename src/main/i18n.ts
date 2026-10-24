import { z } from 'zod'
import {
  resolveLocale,
  translate,
  type Language,
  type Locale,
  type MessageKey,
  type MessageParams
} from '../shared/i18n'

/**
 * Idioma del main: menú, bandeja, notificaciones y mensajes que llegan al renderer. Cambia en
 * caliente con `settings:set`; por defecto, español (también en los tests).
 */
let current: Locale = 'es'

export function setMainLocale(language: Language, preferred: readonly string[]): Locale {
  current = resolveLocale(language, preferred)
  // Mensajes de validación de zod en el mismo idioma.
  z.config(current === 'en' ? z.locales.en() : z.locales.es())
  return current
}

export function mainLocale(): Locale {
  return current
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params)
}
