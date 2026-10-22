import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { describeError } from './logger'

/**
 * Lectura incremental de archivos JSONL. Separa por `\n` en bytes, así el
 * desplazamiento es exacto aunque haya caracteres multibyte, y solo procesa líneas completas: la
 * última, si aún no tiene `\n`, se deja para la siguiente lectura. Nunca lanza.
 */

export type JsonlRecord = { line: number; value: unknown } | { line: number; error: string }

export interface JsonlPosition {
  /** Bytes ya procesados (inicio de la primera línea sin leer). */
  offset: number
  /** Nº de líneas ya procesadas: la siguiente será `line + 1`. */
  line: number
}

export interface JsonlChunk extends JsonlPosition {
  records: JsonlRecord[]
  /** El archivo era más pequeño que `offset`: se ha leído desde el principio. */
  reset: boolean
  /** Error de E/S; en ese caso no hay registros y la posición no avanza. */
  error?: string
}

const NEWLINE = 0x0a
const START: JsonlPosition = { offset: 0, line: 0 }

function parseLine(bytes: Buffer, line: number): JsonlRecord | null {
  let text = bytes.toString('utf8')
  if (text.endsWith('\r')) text = text.slice(0, -1)
  if (line === 1 && text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (!text.trim()) return null
  try {
    return { line, value: JSON.parse(text) as unknown }
  } catch (error) {
    return { line, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function readJsonl(file: string, from: JsonlPosition = START): Promise<JsonlChunk> {
  let reset = false
  let { offset, line } = from
  try {
    const { size } = await stat(file)
    if (size < offset) {
      reset = true
      offset = 0
      line = 0
    }
  } catch (error) {
    return {
      records: [],
      offset: from.offset,
      line: from.line,
      reset: false,
      error: describeError(error)
    }
  }

  const records: JsonlRecord[] = []
  const pending: Buffer[] = []
  try {
    const stream = createReadStream(file, { start: offset })
    for await (const data of stream) {
      const chunk = data as Buffer
      let pos = 0
      let idx = chunk.indexOf(NEWLINE, pos)
      while (idx !== -1) {
        const piece = chunk.subarray(pos, idx)
        const bytes = pending.length ? Buffer.concat([...pending.splice(0), piece]) : piece
        line += 1
        offset += bytes.length + 1
        const record = parseLine(bytes, line)
        if (record) records.push(record)
        pos = idx + 1
        idx = chunk.indexOf(NEWLINE, pos)
      }
      if (pos < chunk.length) pending.push(chunk.subarray(pos))
    }
  } catch (error) {
    return {
      records: [],
      offset: from.offset,
      line: from.line,
      reset: false,
      error: describeError(error)
    }
  }
  return { records, offset, line, reset }
}
