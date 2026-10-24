import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { callUsage } from './sdk-usage'
import { t } from '../i18n'

/**
 * Proceso sonda de Claude Code: sin prompt, sin persistir sesión, solo para
 * la consulta de uso; se cierra siempre. Comprobado con el SDK 0.3.299 en Windows: responde en
 * ~0,9 s, no crea archivos en `projects/` y no gasta tokens.
 */

export interface ProbeQuery extends AsyncIterable<unknown> {
  close?(): void
}

export type ProbeFactory = (args: { prompt: AsyncIterable<never>; options: Options }) => ProbeQuery

const PROBE_TIMEOUT_MS = 15_000

export class ProbeUnsupported extends Error {}

export async function runUsageProbe(
  factory: ProbeFactory,
  options: Options,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<unknown> {
  let release: () => void = () => {}
  // Entrada que no produce nada hasta cerrarla: el proceso arranca sin prompt.
  const input: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<never>>((resolve) => {
          release = () => resolve({ done: true, value: undefined })
        })
    })
  }
  const query = factory({ prompt: input, options: { ...options, persistSession: false } })
  // Vaciar los mensajes para que el proceso no se bloquee; los errores se ven en la consulta.
  void (async () => {
    try {
      for await (const _ of query) void _
    } catch {
      // El cierre o un fallo del proceso: la consulta ya lo refleja.
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const call = callUsage(query)
    if (!call)
      throw new ProbeUnsupported(t('Esta versión de Claude Code no ofrece la consulta de uso'))
    return await Promise.race([
      call,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(t('La consulta de uso no respondió a tiempo'))),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    release()
    try {
      query.close?.()
    } catch {
      // Ya cerrado.
    }
  }
}
