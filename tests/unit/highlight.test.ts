import { describe, expect, it } from 'vitest'
import {
  highlight,
  MAX_HIGHLIGHT_LINES,
  resolveLanguage
} from '../../src/renderer/src/lib/highlight'

describe('highlight (shiki con motor JavaScript y tema de variables CSS)', () => {
  it('resuelve alias y deja fuera lo que no está en la lista blanca', () => {
    expect(resolveLanguage('TS')).toBe('ts')
    expect(resolveLanguage('ps1')).toBe('powershell')
    expect(resolveLanguage('sh')).toBe('bash')
    expect(resolveLanguage('brainfuck')).toBeNull()
    expect(resolveLanguage('')).toBeNull()
    expect(resolveLanguage(undefined)).toBeNull()
  })

  it.each([
    ['ts', 'const a: number = 1 // hola'],
    [
      'vue',
      '<script setup lang="ts">\nconst a = ref(1)\n</script>\n<template><div>{{ a }}</div></template>'
    ],
    ['powershell', 'Get-ChildItem -Path $env:TEMP | Where-Object { $_.Length -gt 0 }'],
    ['ahk', '#Requires AutoHotkey v2.0\nMsgBox "hola"']
  ])(
    '%s: spans con colores de variables y el código escapado',
    async (lang, code) => {
      const html = await highlight(code, lang)
      expect(html).not.toBeNull()
      expect(html).toMatch(/style="color:var\(--shiki-token-[a-z-]+\)"/)
      expect(html).not.toContain('<script')
      expect(html).not.toMatch(/#[0-9a-f]{6}/i)
    },
    20_000
  )

  it('sin resaltar: lenguaje desconocido o bloque demasiado largo', async () => {
    expect(await highlight('x', 'brainfuck')).toBeNull()
    expect(await highlight('a\n'.repeat(MAX_HIGHLIGHT_LINES + 1), 'ts')).toBeNull()
  })

  it('caché: la segunda vez devuelve lo mismo', async () => {
    const a = await highlight('let x = 1', 'js')
    expect(await highlight('let x = 1', 'js')).toBe(a)
  })
})
