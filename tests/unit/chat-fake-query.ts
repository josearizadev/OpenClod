import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { QueryFactory, QueryLike } from '../../src/main/services/chat/chat-session'
import { InputQueue } from '../../src/main/services/chat/input-queue'
import type { ChatEvent } from '../../src/shared/chat'
import { fixtureLines, type ChatCase, type FixtureLine } from './chat-fixtures'

/**
 * `query()` falso para los tests del chat: guarda lo que la sesión le entrega y deja
 * que el test emita los mensajes del SDK de un fixture cuando quiera.
 */
export class FakeQuery implements QueryLike {
  readonly received: SDKUserMessage[] = []
  readonly calls: string[] = []
  inputClosed = false
  closed = false
  private readonly out = new InputQueue<unknown>()
  private failure: Error | null = null

  constructor(
    readonly prompt: AsyncIterable<SDKUserMessage>,
    readonly options: Options
  ) {
    void this.consume()
  }

  private async consume(): Promise<void> {
    for await (const message of this.prompt) this.received.push(message)
    this.inputClosed = true
    // Como el SDK: al cerrar la entrada, el proceso termina y el iterador acaba.
    this.out.close()
  }

  emit(...messages: unknown[]): void {
    for (const m of messages) this.out.push(m)
  }

  /** El proceso muere: el iterador lanza. */
  crash(message = 'Claude Code process exited with code 1'): void {
    this.failure = new Error(message)
    this.out.close()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    for await (const m of this.out) yield m
    if (this.failure) throw this.failure
  }

  async interrupt(): Promise<void> {
    this.calls.push('interrupt')
  }
  async setModel(model?: string): Promise<void> {
    this.calls.push(`setModel:${model ?? ''}`)
  }
  async setPermissionMode(mode: string): Promise<void> {
    this.calls.push(`setPermissionMode:${mode}`)
  }
  async stopTask(taskId: string): Promise<void> {
    this.calls.push(`stopTask:${taskId}`)
  }
  async supportedModels(): Promise<{ value: string; displayName: string; description: string }[]> {
    return [{ value: 'haiku', displayName: 'Haiku', description: 'Rápido' }]
  }
  async supportedCommands(): Promise<{ name: string; description: string }[]> {
    return [{ name: 'siguiente', description: 'Avanza' }]
  }
  mcpServerStatus = async (): Promise<{ name: string; status: string }[]> => []
  close(): void {
    this.closed = true
    this.out.close()
  }
}

export function fakeFactory(): { factory: QueryFactory; queries: FakeQuery[] } {
  const queries: FakeQuery[] = []
  const factory: QueryFactory = ({ prompt, options }) => {
    const q = new FakeQuery(prompt, options)
    queries.push(q)
    return q
  }
  return { factory, queries }
}

/** Deja correr las promesas y el bucle `for await` de la sesión. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r))
}

export interface Replay {
  lines: FixtureLine[]
  position: number
}

export function replay(name: ChatCase): Replay {
  return { lines: fixtureLines(name), position: 0 }
}

/**
 * Emite mensajes del SDK del fixture hasta (incluida) la línea que cumpla `until`. Las líneas
 * `_bitacora` no se emiten; las `canUseTool` llaman al `canUseTool` de la sesión y se devuelven
 * para que el test responda.
 */
export async function emitUntil(
  fake: FakeQuery,
  r: Replay,
  until: (line: FixtureLine) => boolean = () => false,
  onCanUseTool?: (line: FixtureLine, result: Promise<unknown>) => Promise<void> | void
): Promise<FixtureLine | undefined> {
  while (r.position < r.lines.length) {
    const line = r.lines[r.position++] as FixtureLine
    if (line['type'] === '_bitacora') {
      if (line['event'] === 'canUseTool' && onCanUseTool) {
        const canUseTool = fake.options.canUseTool as NonNullable<Options['canUseTool']>
        await flush()
        const result = canUseTool(
          line['toolName'] as string,
          line['input'] as Record<string, unknown>,
          {
            ...(line['options'] as Record<string, unknown>),
            signal: new AbortController().signal
          } as Parameters<NonNullable<Options['canUseTool']>>[2]
        )
        await flush()
        await onCanUseTool(line, result)
        await result
        await flush()
      }
      if (until(line)) return line
      continue
    }
    fake.emit(line)
    await flush()
    if (until(line)) return line
  }
  return undefined
}

/** Líneas `_bitacora push` del fixture, en orden. */
export function pushes(name: ChatCase): { uuid: string; text: string; priority?: string }[] {
  return fixtureLines(name)
    .filter((l) => l['type'] === '_bitacora' && l['event'] === 'push')
    .map((l) => {
      const m = l['message'] as Record<string, unknown>
      const message = m['message'] as { content: string }
      return {
        uuid: m['uuid'] as string,
        text: message.content,
        ...(m['priority'] ? { priority: m['priority'] as string } : {})
      }
    })
}

export const isResult = (l: FixtureLine): boolean => l['type'] === 'result'

export function events(log: ChatEvent[], kind: ChatEvent['kind']): ChatEvent[] {
  return log.filter((e) => e.kind === kind)
}
