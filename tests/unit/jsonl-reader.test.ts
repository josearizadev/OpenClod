import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonl } from '../../src/main/services/jsonl-reader'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(content: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'bitacora-jsonl-'))
  dirs.push(dir)
  const file = join(dir, 'sesion.jsonl')
  writeFileSync(file, content)
  return file
}

describe('readJsonl', () => {
  it('lee cada línea completa con su número y anota las inválidas sin lanzar', async () => {
    const file = tempFile('{"a":1}\n{roto\n\n[1,2]\r\n{"b":"ñ"}\n')
    const chunk = await readJsonl(file)
    expect(chunk.records).toEqual([
      { line: 1, value: { a: 1 } },
      { line: 2, error: expect.any(String) },
      { line: 4, value: [1, 2] },
      { line: 5, value: { b: 'ñ' } }
    ])
    expect(chunk.line).toBe(5)
    expect(chunk.reset).toBe(false)
  })

  it('deja la línea final sin \\n para la siguiente lectura', async () => {
    const file = tempFile('{"a":1}\n{"b":')
    const first = await readJsonl(file)
    expect(first.records).toEqual([{ line: 1, value: { a: 1 } }])
    expect(first.offset).toBe(8)
    appendFileSync(file, '2}\n{"c":3}\n')
    const second = await readJsonl(file, first)
    expect(second.records).toEqual([
      { line: 2, value: { b: 2 } },
      { line: 3, value: { c: 3 } }
    ])
  })

  it('el desplazamiento es en bytes: dos tandas dan lo mismo que una con multibyte', async () => {
    const lines = ['{"t":"€uro 😀"}', '{"t":"añadido"}', '{"t":"más"}']
    const file = tempFile(`${lines[0]}\n`)
    const first = await readJsonl(file)
    expect(first.offset).toBe(Buffer.byteLength(`${lines[0]}\n`))
    appendFileSync(file, `${lines[1]}\n${lines[2]}\n`)
    const second = await readJsonl(file, first)
    const whole = await readJsonl(file)
    expect([...first.records, ...second.records]).toEqual(whole.records)
    expect(second.offset).toBe(whole.offset)
  })

  it('parte un carácter multibyte entre trozos del stream sin corromperlo', async () => {
    // Una línea más larga que el trozo por defecto del stream (64 KiB) llena de multibyte.
    const big = 'é'.repeat(70_000)
    const file = tempFile(`{"t":"${big}"}\n`)
    const chunk = await readJsonl(file)
    expect(chunk.records).toEqual([{ line: 1, value: { t: big } }])
  })

  it('si el archivo encoge, avisa con reset y relee desde el principio', async () => {
    const file = tempFile('{"a":1}\n{"b":2}\n')
    const first = await readJsonl(file)
    writeFileSync(file, '{"z":0}\n')
    const second = await readJsonl(file, first)
    expect(second.reset).toBe(true)
    expect(second.records).toEqual([{ line: 1, value: { z: 0 } }])
  })

  it('sin cambios no devuelve registros y conserva la posición', async () => {
    const file = tempFile('{"a":1}\n')
    const first = await readJsonl(file)
    const second = await readJsonl(file, first)
    expect(second).toEqual({ records: [], offset: first.offset, line: 1, reset: false })
  })

  it('si el archivo no existe devuelve error y ningún registro', async () => {
    const chunk = await readJsonl(join(tmpdir(), 'no-existe-bitacora.jsonl'))
    expect(chunk.records).toEqual([])
    expect(chunk.error).toBeTruthy()
  })
})
