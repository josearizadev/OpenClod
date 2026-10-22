import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../../src/main/services/logger'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bitacora-logger-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('logger', () => {
  it('crea la carpeta y escribe líneas con nivel y ámbito', () => {
    const dir = join(tempDir(), 'logs')
    const log = createLogger(dir)
    log.info('main', 'Arranque')
    log.error('ipc', new TypeError('fallo'))
    const content = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(content).toMatch(/INFO \[main\] Arranque/)
    expect(content).toMatch(/ERROR \[ipc\] TypeError: fallo/)
  })

  it('rota al superar el tamaño y conserva como mucho maxFiles archivos', () => {
    const dir = tempDir()
    const log = createLogger(dir, { maxBytes: 200, maxFiles: 3 })
    for (let i = 0; i < 40; i++) log.info('t', `linea ${i} ${'x'.repeat(40)}`)
    expect(existsSync(join(dir, 'main.log'))).toBe(true)
    expect(existsSync(join(dir, 'main.log.1'))).toBe(true)
    expect(existsSync(join(dir, 'main.log.2'))).toBe(true)
    expect(existsSync(join(dir, 'main.log.3'))).toBe(false)
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toMatch(/linea 39/)
  })

  it('no lanza si no puede escribir', () => {
    const dir = tempDir()
    const blocker = join(dir, 'soy-un-archivo')
    writeFileSync(blocker, '')
    const log = createLogger(join(blocker, 'logs'))
    expect(() => log.error('main', 'algo')).not.toThrow()
  })
})
