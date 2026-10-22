import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fixtures reales del Agent SDK de la fase 4 (tarea 1, `scripts/grabar-sdk.mjs`): mensajes del SDK
 * más líneas `_bitacora` con lo que hizo el guion, y al lado el JSONL que escribió Claude Code.
 */
const SDK_FIXTURES = join(__dirname, '../fixtures/sdk')

export type ChatCase =
  'edicion' | 'cola' | 'tareas' | 'pregunta' | 'plan' | 'interrupcion' | 'saltar'

export const CHAT_CASES: ChatCase[] = [
  'edicion',
  'cola',
  'tareas',
  'pregunta',
  'plan',
  'interrupcion',
  'saltar'
]

export type FixtureLine = Record<string, unknown>

/** Todas las líneas del fixture, incluidas las `_bitacora`. */
export function fixtureLines(name: ChatCase): FixtureLine[] {
  return readFileSync(join(SDK_FIXTURES, `chat-${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as FixtureLine)
}

/** Solo los mensajes del SDK, en orden. */
export function sdkMessages(name: ChatCase): FixtureLine[] {
  return fixtureLines(name).filter((line) => line['type'] !== '_bitacora')
}

/** Archivo de disco de la sesión del fixture. */
export function diskFile(name: ChatCase): string {
  const dir = join(SDK_FIXTURES, `chat-${name}.disco`)
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl'))
  if (!file) throw new Error(`Sin JSONL en ${dir}`)
  return join(dir, file)
}
