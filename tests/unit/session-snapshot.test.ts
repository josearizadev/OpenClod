import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readJsonl } from '../../src/main/services/jsonl-reader'
import {
  PARSER_VERSION,
  SessionAccumulator,
  type AccumulatorOptions
} from '../../src/main/services/session-parser'

const FIXTURES = join(__dirname, '../fixtures/claude/projects')
const TMP = mkdtempSync(join(tmpdir(), 'bitacora-snapshot-'))

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

/** Todos los `.jsonl` de los fixtures (principales y subagentes). */
function jsonlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.name.endsWith('.jsonl') ? [path] : []
  })
}

function optionsFor(file: string): AccumulatorOptions {
  const name = basename(file, '.jsonl')
  return name.startsWith('agent-') ? { agentId: name.slice('agent-'.length) } : {}
}

/** Desplazamiento justo después de la 1ª línea de un mensaje del asistente que sigue en la siguiente. */
function cutInsideMessage(bytes: Buffer): number | null {
  let start = 0
  let previousId: string | undefined
  let previousEnd = 0
  while (start < bytes.length) {
    const end = bytes.indexOf(0x0a, start)
    if (end === -1) break
    let id: string | undefined
    try {
      const value = JSON.parse(bytes.subarray(start, end).toString('utf8')) as {
        type?: string
        message?: { id?: string }
      }
      id = value.type === 'assistant' ? value.message?.id : undefined
    } catch {
      id = undefined
    }
    if (id && id === previousId) return previousEnd
    previousId = id
    previousEnd = end + 1
    start = end + 1
  }
  return null
}

/** Puntos de corte: proporciones del archivo (casi siempre a mitad de línea) y dentro de un mensaje. */
function cutPoints(bytes: Buffer): number[] {
  const cuts = new Set([0.1, 0.33, 0.5, 0.77, 0.95].map((f) => Math.floor(bytes.length * f)))
  const inside = cutInsideMessage(bytes)
  if (inside !== null) cuts.add(inside)
  cuts.add(1)
  cuts.add(bytes.length - 1)
  return [...cuts].filter((cut) => cut > 0 && cut < bytes.length).sort((a, b) => a - b)
}

const files = jsonlFiles(FIXTURES)

describe('snapshot → restore → resto = lectura única', () => {
  it('hay fixtures con mensajes repartidos en varias líneas', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files.some((file) => cutInsideMessage(readFileSync(file)) !== null)).toBe(true)
  })

  describe.each(files.map((file) => [relative(FIXTURES, file), file]))('%s', (_name, file) => {
    const bytes = readFileSync(file)
    const options = optionsFor(file)

    it.each(cutPoints(bytes))('cortado en el byte %i', async (cut) => {
      const whole = new SessionAccumulator(options).addChunk(await readJsonl(file))

      // El archivo «crece» igual que mientras Claude Code escribe: primero una parte, luego todo.
      const copy = join(TMP, `${basename(file)}-${cut}`)
      writeFileSync(copy, bytes.subarray(0, cut))
      const first = await readJsonl(copy)
      const before = new SessionAccumulator({ ...options, keepItems: false }).addChunk(first)
      const drained = before.drainItems()
      // Se guarda como texto, igual que en la columna `state` del índice.
      const stored = JSON.stringify(before.snapshot())

      writeFileSync(copy, bytes)
      const rest = await readJsonl(copy, { offset: first.offset, line: first.line })
      expect(rest.reset).toBe(false)
      const after = SessionAccumulator.restore(JSON.parse(stored), {
        ...options,
        keepItems: false
      })
      expect(after).not.toBeNull()
      after!.addChunk(rest)

      expect(after!.stats()).toEqual(whole.stats())
      expect(after!.usage).toEqual(whole.usage)
      expect([...drained, ...after!.drainItems()]).toEqual(whole.items)
    })
  })
})

describe('restore', () => {
  const file = join(FIXTURES, 'Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423.jsonl')

  it('devuelve null con un snapshot de otra versión del parser', async () => {
    const acc = new SessionAccumulator().addChunk(await readJsonl(file))
    const snapshot = { ...acc.snapshot(), v: PARSER_VERSION + 1 }
    expect(SessionAccumulator.restore(snapshot)).toBeNull()
  })

  it.each([
    ['null', null],
    ['texto', 'hola'],
    ['objeto vacío', {}],
    ['sin diag', { v: PARSER_VERSION, info: {}, prompts: 0 }]
  ])('devuelve null con un snapshot malformado (%s)', (_name, snapshot) => {
    expect(SessionAccumulator.restore(snapshot)).toBeNull()
  })

  it('con un campo de tipo incorrecto devuelve null sin lanzar', async () => {
    const acc = new SessionAccumulator().addChunk(await readJsonl(file))
    expect(SessionAccumulator.restore({ ...acc.snapshot(), models: 'claude' })).toBeNull()
  })
})

describe('metadatos de la sesión', () => {
  it('startCwd es el primer cwd y cwd el último', () => {
    const acc = new SessionAccumulator().addAll([
      { line: 1, value: { type: 'user', cwd: 'Z:\\web\\uno', message: { content: 'hola' } } },
      { line: 2, value: { type: 'user', cwd: 'Z:\\web\\dos', message: { content: 'adiós' } } }
    ])
    expect(acc.stats()).toMatchObject({ startCwd: 'Z:\\web\\uno', cwd: 'Z:\\web\\dos' })
  })

  it('promptCount cuenta solo los prompts reales', () => {
    const acc = new SessionAccumulator().addAll([
      { line: 1, value: { type: 'user', message: { content: 'hola' } } },
      {
        line: 2,
        value: { type: 'user', message: { content: '<command-name>/clear</command-name>' } }
      },
      { line: 3, value: { type: 'user', isMeta: true, message: { content: 'caveat' } } },
      { line: 4, value: { type: 'user', message: { content: 'otra' } } }
    ])
    expect(acc.stats().promptCount).toBe(2)
  })

  it('una sesión sin prompts tiene promptCount 0', () => {
    const acc = new SessionAccumulator().addAll([
      { line: 1, value: { type: 'ai-title', aiTitle: 'Algo' } }
    ])
    expect(acc.stats().promptCount).toBe(0)
  })

  it('drainItems devuelve cada elemento una vez; con keepItems false los suelta', () => {
    const records = [
      { line: 1, value: { type: 'user', uuid: 'u1', message: { content: 'hola' } } },
      { line: 2, value: { type: 'user', uuid: 'u2', message: { content: 'otra' } } }
    ]
    const kept = new SessionAccumulator()
    kept.add(records[0]!)
    expect(kept.drainItems().map((item) => item.uuid)).toEqual(['u1'])
    kept.add(records[1]!)
    expect(kept.drainItems().map((item) => item.uuid)).toEqual(['u2'])
    expect(kept.items).toHaveLength(2)

    const dropped = new SessionAccumulator({ keepItems: false })
    dropped.add(records[0]!)
    expect(dropped.drainItems().map((item) => item.uuid)).toEqual(['u1'])
    expect(dropped.items).toHaveLength(0)
    dropped.add(records[1]!)
    expect(dropped.drainItems().map((item) => item.uuid)).toEqual(['u2'])
    expect(dropped.drainItems()).toEqual([])
  })
})
