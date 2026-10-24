import { describe, expect, it } from 'vitest'
import { resolveLocale, translate } from '../../src/shared/i18n'
import { en } from '../../src/shared/i18n/en'
import { parseAuthStatus } from '../../src/main/services/auth'
import { claudeLoginLine } from '../../src/main/services/shell'

describe('translate', () => {
  it('devuelve la clave en español y la traducción en inglés', () => {
    expect(translate('es', 'Nueva sesión')).toBe('Nueva sesión')
    expect(translate('en', 'Nueva sesión')).toBe('New session')
  })

  it('sustituye parámetros y formatea números según el idioma', () => {
    expect(translate('es', '{n} sesiones', { n: 12345 })).toBe('12.345 sesiones')
    expect(translate('en', '{n} sesiones', { n: 12345 })).toBe('12,345 sessions')
    expect(translate('en', 'Plan {plan}', { plan: 'Pro' })).toBe('Pro plan')
  })

  it('cada traducción conserva los parámetros de su clave', () => {
    const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
    for (const [key, value] of Object.entries(en)) expect(params(value), key).toEqual(params(key))
  })
})

describe('resolveLocale', () => {
  it('respeta la elección y, con «system», el primer idioma conocido', () => {
    expect(resolveLocale('en', ['es-ES'])).toBe('en')
    expect(resolveLocale('system', ['es-419'])).toBe('es')
    expect(resolveLocale('system', ['fr-FR', 'en-GB'])).toBe('en')
    expect(resolveLocale('system', ['de'])).toBe('en')
  })
})

describe('parseAuthStatus', () => {
  it('con sesión copia solo los campos permitidos', () => {
    const out = parseAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        email: 'ana@example.com',
        orgId: 'secreto',
        subscriptionType: 'pro'
      })
    )
    expect(out).toEqual({
      state: 'in',
      method: 'claude.ai',
      email: 'ana@example.com',
      plan: 'pro',
      provider: 'firstParty'
    })
  })

  it('sin sesión o con basura', () => {
    expect(parseAuthStatus('{"loggedIn":false,"authMethod":"none"}')).toEqual({ state: 'out' })
    expect(parseAuthStatus('no es json')).toEqual({ state: 'unknown' })
    expect(parseAuthStatus('[]')).toEqual({ state: 'unknown' })
    expect(parseAuthStatus('{"email":"x"}')).toEqual({ state: 'unknown' })
  })
})

describe('claudeLoginLine', () => {
  it('prefiere el binario de la app y cierra el shell al terminar', () => {
    const bundled = 'C:\\App\\claude.exe'
    expect(claudeLoginLine('powershell', { onPath: true, bundled })).toBe(
      `& '${bundled}' auth login; exit`
    )
    expect(claudeLoginLine('cmd', { onPath: false, bundled })).toBe(
      `"${bundled}" auth login & exit`
    )
    expect(claudeLoginLine('posix', { onPath: true, bundled: null })).toBe(
      'claude auth login; exit'
    )
    expect(claudeLoginLine('posix', { onPath: false, bundled: null })).toBeNull()
  })
})
