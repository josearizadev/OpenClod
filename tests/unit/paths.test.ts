import { describe, expect, it } from 'vitest'
import { isInside, normalizePath, pathKey } from '../../src/main/services/paths'

describe('normalizePath (Windows)', () => {
  it.each([
    ['C:\\x', 'C:\\x'],
    ['c:/x/', 'C:\\x'],
    ['  c:\\x\\\\y\\  ', 'C:\\x\\y'],
    ['/c/x', 'C:\\x'],
    ['/c/x/y/', 'C:\\x\\y'],
    ['/c', 'C:\\'],
    ['/c/', 'C:\\'],
    ['C:\\', 'C:\\'],
    ['c:/', 'C:\\'],
    ['C:', 'C:\\'],
    ['C:\\x\\..\\y', 'C:\\y'],
    ['Z:\\web\\Nube', 'Z:\\web\\Nube'],
    ['\\\\servidor\\compartida\\x\\', '\\\\servidor\\compartida\\x'],
    ['//servidor/compartida/x', '\\\\servidor\\compartida\\x'],
    ['', '']
  ])('%j → %j', (input, expected) => {
    expect(normalizePath(input, 'win32')).toBe(expected)
  })

  it('conserva las mayúsculas salvo la letra de unidad', () => {
    expect(normalizePath('c:\\Users\\Ana\\Proyecto', 'win32')).toBe('C:\\Users\\Ana\\Proyecto')
  })

  it('una carpeta de Git Bash con más de una letra no es una unidad', () => {
    expect(normalizePath('/cd/x', 'win32')).toBe('\\cd\\x')
  })
})

describe('normalizePath (POSIX)', () => {
  it.each([
    ['/home/ana/x/', '/home/ana/x'],
    ['/home//ana/./x', '/home/ana/x'],
    ['/', '/'],
    ['/c/x', '/c/x']
  ])('%j → %j', (input, expected) => {
    expect(normalizePath(input, 'linux')).toBe(expected)
  })
})

describe('pathKey', () => {
  it('en Windows no distingue mayúsculas ni formas de escribir la misma ruta', () => {
    expect(pathKey('C:\\WINDOWS\\system32', 'win32')).toBe(
      pathKey('C:\\Windows\\System32', 'win32')
    )
    expect(pathKey('/c/Windows/', 'win32')).toBe(pathKey('c:\\windows', 'win32'))
    expect(pathKey('\\\\Servidor\\Compartida', 'win32')).toBe(
      pathKey('//servidor/compartida/', 'win32')
    )
  })

  it('en POSIX distingue mayúsculas', () => {
    expect(pathKey('/home/Ana', 'linux')).not.toBe(pathKey('/home/ana', 'linux'))
  })
})

describe('isInside', () => {
  it.each([
    ['C:\\Users\\Ana\\.claude', 'C:\\Users\\Ana\\.claude', true],
    ['c:/users/ana/.claude/projects/x', 'C:\\Users\\Ana\\.claude', true],
    ['/c/Users/Ana/.claude/', 'C:\\Users\\Ana\\.claude', true],
    ['C:\\Users\\Ana\\.claude-otra', 'C:\\Users\\Ana\\.claude', false],
    ['C:\\Users\\Ana', 'C:\\Users\\Ana\\.claude', false],
    ['C:\\x', 'C:\\', true],
    ['D:\\x', 'C:\\', false],
    ['', 'C:\\', false]
  ])('%j dentro de %j → %s', (child, parent, expected) => {
    expect(isInside(child, parent, 'win32')).toBe(expected)
  })

  it('en POSIX', () => {
    expect(isInside('/home/ana/.claude/projects', '/home/ana/.claude', 'linux')).toBe(true)
    expect(isInside('/home/ana/.claudex', '/home/ana/.claude', 'linux')).toBe(false)
    expect(isInside('/home/ana', '/', 'linux')).toBe(true)
  })
})
