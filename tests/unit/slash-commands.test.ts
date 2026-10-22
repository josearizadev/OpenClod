import { describe, expect, it } from 'vitest'
import { classifySlash, parseSlash, slashEntries } from '../../src/renderer/src/lib/slash-commands'

const catalog = [
  { name: 'compact', description: 'Resumir' },
  { name: 'siguiente', description: 'Avanza' },
  { name: 'status', description: 'Propio del usuario' },
  { name: '__remote-workflow', description: 'Interno' }
]

describe('comandos /', () => {
  it('reconoce el comando y sus argumentos', () => {
    expect(parseSlash('/plan  haz esto\ny esto')).toEqual({
      name: 'plan',
      args: 'haz esto\ny esto'
    })
    expect(parseSlash('/plugin:skill')).toEqual({ name: 'plugin:skill', args: '' })
    expect(parseSlash('hola /chrome')).toBeNull()
    expect(parseSlash('/')).toBeNull()
  })

  it('clasifica: app, Claude Code, terminal o texto', () => {
    expect(classifySlash('/chrome', catalog)).toMatchObject({ kind: 'app', id: 'chrome' })
    expect(classifySlash('/allowed-tools', catalog)).toMatchObject({
      kind: 'app',
      id: 'permissions'
    })
    expect(classifySlash('/Quit', catalog)).toMatchObject({ kind: 'app', id: 'exit' })
    expect(classifySlash('/compact', catalog)).toEqual({ kind: 'claude' })
    expect(classifySlash('/siguiente fase', catalog)).toEqual({ kind: 'claude' })
    // Un comando del usuario con el nombre de uno del terminal: lo ejecuta Claude Code.
    expect(classifySlash('/status', catalog)).toEqual({ kind: 'claude' })
    expect(classifySlash('/login', catalog)).toMatchObject({ kind: 'terminal', name: 'login' })
    expect(classifySlash('/desconocido', catalog)).toEqual({ kind: 'claude' })
    expect(classifySlash('hola', catalog)).toEqual({ kind: 'claude' })
  })

  it('el autocompletado junta las tres fuentes sin repetir', () => {
    const entries = slashEntries(catalog)
    const names = entries.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('__remote-workflow')
    expect(entries.find((e) => e.name === 'chrome')?.source).toBe('app')
    expect(entries.find((e) => e.name === 'compact')?.source).toBe('claude')
    expect(entries.find((e) => e.name === 'status')?.source).toBe('claude')
    expect(entries.find((e) => e.name === 'login')?.source).toBe('terminal')
  })
})
