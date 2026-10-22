import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJsonl, type JsonlRecord } from '../../src/main/services/jsonl-reader'
import {
  classifyUserText,
  compareVersions,
  previewOf,
  resolveTitle,
  SessionAccumulator
} from '../../src/main/services/session-parser'
import type { TranscriptItem } from '../../src/shared/sessions'

/** Sesiones reales anonimizadas (scripts/anonimizar-fixture.mjs) + una corrupta escrita a mano. */
const PROJECTS = join(__dirname, '../fixtures/claude/projects')
const NUBE = join(PROJECTS, 'Z--web-Nube')
const GRANDE = join(NUBE, '0e56deca-67ad-4d7c-bc94-a61cc14540cd.jsonl')
const CONTINUADA = join(NUBE, 'a55accdd-171f-4711-936e-b51294a4b423.jsonl')
const PROGRAMAS = join(PROJECTS, 'C--Programas', '3f010094-259d-4b05-80f2-637772220194.jsonl')
const CORRUPTA = join(PROJECTS, 'Z--demo', '00000000-0000-4000-8000-000000000001.jsonl')
/** Final real de una sesión que alcanzó el límite de 5 h (anonimizado). */
const LIMITE = join(__dirname, '../fixtures/fragmentos/limite-alcanzado.jsonl')
const CONTINUACION = join(NUBE, '9c81d504-7ee7-4a60-a274-500078e29ce3.jsonl')

async function parse(file: string, acc = new SessionAccumulator()): Promise<SessionAccumulator> {
  return acc.addChunk(await readJsonl(file))
}

function kinds(items: TranscriptItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1
  return counts
}

describe('classifyUserText', () => {
  it('reconoce comandos con su nombre y argumentos', () => {
    const text =
      '<command-message>siguiente</command-message>\n<command-name>/siguiente</command-name>\n<command-args>Haz la fase 1</command-args>'
    expect(classifyUserText(text)).toEqual({
      kind: 'command',
      name: '/siguiente',
      args: 'Haz la fase 1'
    })
  })

  it('reconoce salidas de comandos sin etiquetas', () => {
    expect(
      classifyUserText('<local-command-stdout>Login successful</local-command-stdout>')
    ).toEqual({ kind: 'command-output', stream: 'stdout', text: 'Login successful' })
    expect(classifyUserText('<local-command-stderr>fallo</local-command-stderr>')).toMatchObject({
      stream: 'stderr',
      text: 'fallo'
    })
  })

  it('separa avisos internos, notificaciones de tareas e interrupciones', () => {
    expect(classifyUserText('hola', true).kind).toBe('meta')
    expect(classifyUserText('<local-command-caveat>Caveat: …</local-command-caveat>').kind).toBe(
      'meta'
    )
    expect(classifyUserText('<system-reminder>x</system-reminder>').kind).toBe('meta')
    expect(classifyUserText('<task-notification>\n<task-id>b1</task-id>').kind).toBe(
      'task-notification'
    )
    expect(classifyUserText('[Request interrupted by user for tool use]').kind).toBe('interrupted')
  })

  it('el resto es un prompt real', () => {
    expect(classifyUserText('[Image #1] ¿Cuál me descargo?')).toEqual({
      kind: 'user-prompt',
      text: '[Image #1] ¿Cuál me descargo?',
      images: 0
    })
  })
})

describe('resolveTitle', () => {
  it('sigue el orden app → agent-name → aiTitle → primer prompt', () => {
    const all = { appTitle: 'Mío', agentName: 'renombrada', aiTitle: 'IA', firstPrompt: 'hola' }
    expect(resolveTitle(all)).toEqual({ title: 'Mío', source: 'app' })
    expect(resolveTitle({ ...all, appTitle: undefined })).toEqual({
      title: 'renombrada',
      source: 'agent-name'
    })
    expect(resolveTitle({ aiTitle: 'IA', firstPrompt: 'hola' })).toEqual({
      title: 'IA',
      source: 'ai-title'
    })
    expect(resolveTitle({ aiTitle: '  ', firstPrompt: 'hola\n  mundo' })).toEqual({
      title: 'hola mundo',
      source: 'prompt'
    })
    expect(resolveTitle({ firstPrompt: 'hola', firstCommand: '/siguiente' })).toEqual({
      title: 'hola',
      source: 'prompt'
    })
    expect(resolveTitle({ firstCommand: '/siguiente Termina la fase 2.' })).toEqual({
      title: '/siguiente Termina la fase 2.',
      source: 'command'
    })
    expect(resolveTitle({})).toEqual({ title: '(sin título)', source: 'none' })
  })

  it('una sesión que empieza con un comando lo usa de título si no hay prompts', () => {
    const acc = new SessionAccumulator()
    const user = (uuid: string, content: string): Record<string, unknown> => ({
      type: 'user',
      uuid,
      timestamp: '2026-10-14T10:00:00.000Z',
      message: { role: 'user', content }
    })
    const reply = {
      type: 'assistant',
      uuid: 'r',
      timestamp: '2026-10-14T10:00:05.000Z',
      message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [] }
    }
    const records = [
      user('a', '<command-name>/clear</command-name>'),
      user(
        'b',
        '<command-message>siguiente</command-message>\n<command-name>/siguiente</command-name>\n<command-args>Termina la fase 2.</command-args>'
      ),
      reply,
      user('c', '<command-name>/model</command-name>')
    ].map((value, i) => ({ line: i + 1, value }))

    // Antes de la respuesta, el candidato es el último comando; con la respuesta se fija.
    acc.addChunk({ records: records.slice(0, 1), line: 1 })
    expect(acc.stats().firstCommand).toBe('/clear')
    const restored = SessionAccumulator.restore(
      JSON.parse(JSON.stringify(acc.snapshot())),
      {}
    ) as SessionAccumulator
    restored.addChunk({ records: records.slice(1), line: 4 })
    const stats = restored.stats()
    expect(stats.promptCount).toBe(0)
    expect(stats.firstCommand).toBe('/siguiente Termina la fase 2.')
  })

  it('recorta a 80 caracteres en una línea', () => {
    const { title } = resolveTitle({ firstPrompt: 'palabra '.repeat(30) })
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toMatch(/\n/)
  })

  it('previewOf colapsa espacios y devuelve undefined si no hay texto', () => {
    expect(previewOf(' a \n b ')).toBe('a b')
    expect(previewOf('   ')).toBeUndefined()
  })
})

describe('SessionAccumulator con la sesión grande (1.159 líneas, CLI 2.1.275)', async () => {
  const acc = await parse(GRANDE)
  const stats = acc.stats()

  it('lee todas las líneas sin anomalías', () => {
    expect(stats.diagnostics).toMatchObject({
      lines: 1159,
      invalidCount: 0,
      unknownLineTypes: {},
      unknownBlockTypes: {}
    })
    expect(stats.cliVersions).toEqual(['2.1.275'])
  })

  it('produce los elementos esperados de cada tipo', () => {
    expect(kinds(acc.items)).toEqual({
      'user-prompt': 7,
      command: 1,
      meta: 1,
      'task-notification': 2,
      interrupted: 1,
      'assistant-text': 55,
      thinking: 80,
      'tool-use': 189,
      'tool-result': 189,
      system: 10,
      attachment: 197
    })
  })

  it('cada tool_use tiene su tool_result', () => {
    const uses = new Set(acc.items.flatMap((i) => (i.kind === 'tool-use' ? [i.id] : [])))
    const results = new Set(
      acc.items.flatMap((i) => (i.kind === 'tool-result' ? [i.toolUseId] : []))
    )
    expect(results).toEqual(uses)
  })

  it('calcula el resumen', () => {
    expect(stats).toMatchObject({
      sessionId: '0e56deca-67ad-4d7c-bc94-a61cc14540cd',
      cwd: 'Z:\\web\\Nube',
      gitBranch: 'main',
      startedAt: '2026-09-18T14:08:01.315Z',
      updatedAt: '2026-09-18T15:44:54.893Z',
      models: ['claude-sonnet-5'],
      toolCallCount: 189,
      agentName: 'ut enim labore do sit',
      lastPrompt: 'consectetur consectetur do lorem'
    })
    // 7 prompts reales + 55 mensajes del asistente con texto.
    expect(stats.messageCount).toBe(7 + 55)
    expect(stats.firstPrompt).toBeTruthy()
  })

  it('el comando conserva su nombre', () => {
    expect(acc.items.find((i) => i.kind === 'command')).toMatchObject({ name: '/clear' })
  })

  it('un evento de uso por mensaje, con el máximo de salida', () => {
    expect(acc.usage).toHaveLength(159)
    const keys = new Set(acc.usage.map((e) => e.key))
    expect(keys.size).toBe(159)
    expect(acc.usage.every((e) => e.model === 'claude-sonnet-5' && !e.agentId)).toBe(true)
  })

  it('los adjuntos solo exponen su tipo', () => {
    const attachments = acc.items.filter((i) => i.kind === 'attachment')
    for (const item of attachments) {
      expect(Object.keys(item).sort()).toEqual(
        ['attachmentType', 'kind', 'line', 'sidechain', 'timestamp', 'uuid'].filter(
          (k) => k in item
        )
      )
    }
  })

  it('procesa la sesión duplicada (2.318 líneas) en menos de 200 ms', async () => {
    const chunk = await readJsonl(GRANDE)
    const records: JsonlRecord[] = [
      ...chunk.records,
      ...chunk.records.map((r) => ({ ...r, line: r.line + chunk.line }))
    ]
    const started = performance.now()
    new SessionAccumulator().addAll(records).stats()
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('ignora las líneas de petición a la API de la CLI 2.1.30x sin leer su contenido', () => {
    const acc = new SessionAccumulator().addAll(
      ['api-request', 'api-request-blob', 'api-request-shape', 'atis-latch', 'mode'].map(
        (type, i) => ({ line: i + 1, value: { type, body: { messages: ['secreto'] } } })
      )
    )
    expect(acc.items).toEqual([])
  })
})

describe('SessionAccumulator con otros fixtures', () => {
  it('cuenta las imágenes de los prompts', async () => {
    const acc = await parse(PROGRAMAS)
    const prompts = acc.items.filter((i) => i.kind === 'user-prompt')
    expect(prompts.reduce((sum, p) => sum + (p.kind === 'user-prompt' ? p.images : 0), 0)).toBe(2)
    expect(acc.stats().diagnostics.cliVersions).toEqual(['2.1.283', '2.1.284', '2.1.285'])
  })

  it('lee continued-in y el título de la IA', async () => {
    const stats = (await parse(CONTINUADA)).stats()
    expect(stats.continuedIn).toBe('9c81d504-7ee7-4a60-a274-500078e29ce3')
    expect(stats.aiTitle).toBe('ut enim labore do sit')
    expect(stats.agentName).toBeUndefined()
  })

  it('genera subagent-ref tras el tool_use que lanzó cada subagente', async () => {
    const meta = { agentId: 'a3aa898a77e40ab58', agentType: 'Explore', description: 'x' }
    const plain = await parse(CONTINUADA)
    const agentUse = plain.items.find((i) => i.kind === 'tool-use' && i.name === 'Agent')
    if (agentUse?.kind !== 'tool-use') throw new Error('sin tool_use Agent')
    const acc = await parse(
      CONTINUADA,
      new SessionAccumulator({ subagentsByToolUse: new Map([[agentUse.id, meta]]) })
    )
    const index = acc.items.findIndex((i) => i.kind === 'subagent-ref')
    expect(acc.items[index - 1]).toMatchObject({ kind: 'tool-use', id: agentUse.id })
    expect(acc.items[index]).toMatchObject({
      kind: 'subagent-ref',
      toolUseId: agentUse.id,
      ...meta
    })
  })

  it('en un subagente, el encargo cuenta como prompt y el uso lleva su agentId', async () => {
    const file = join(
      NUBE,
      'a55accdd-171f-4711-936e-b51294a4b423/subagents/agent-a8bf231e68420c4fd.jsonl'
    )
    const acc = await parse(file, new SessionAccumulator({ agentId: 'a8bf231e68420c4fd' }))
    expect(acc.stats().firstPrompt).toBeTruthy()
    expect(acc.items.every((i) => i.sidechain)).toBe(true)
    expect(acc.usage.length).toBeGreaterThan(0)
    expect(acc.usage.every((e) => e.agentId === 'a8bf231e68420c4fd')).toBe(true)
  })
})

describe('SessionAccumulator con la sesión corrupta', async () => {
  const acc = await parse(CORRUPTA)
  const stats = acc.stats()

  it('anota la línea inválida y los tipos desconocidos sin lanzar', () => {
    expect(stats.diagnostics).toEqual({
      lines: 10,
      invalidCount: 1,
      invalidLines: [2],
      unknownLineTypes: { 'nuevo-tipo': 1, '(sin tipo)': 1 },
      unknownBlockTypes: { future_block: 1, '(contenido no reconocido)': 1 },
      cliVersions: ['2.1.299', '2.1.300']
    })
    expect(acc.items.filter((i) => i.kind === 'unknown')).toEqual([
      expect.objectContaining({ line: 3, originalType: 'future_block' }),
      expect.objectContaining({ line: 5, originalType: 'nuevo-tipo' }),
      expect.objectContaining({ line: 6, originalType: '(sin tipo)' }),
      expect.objectContaining({ line: 8, originalType: '(contenido no reconocido)' })
    ])
  })

  it('fusiona las dos líneas del mismo mensaje y excluye <synthetic>', () => {
    expect(acc.usage).toEqual([
      {
        key: 'msg_1:req_1',
        model: 'claude-opus-5-5',
        timestamp: '2026-10-01T10:00:05.000Z',
        usage: { input: 10, output: 42, cacheCreation: 100, cacheRead: 1000 }
      }
    ])
    expect(stats.models).toEqual(['claude-opus-5-5'])
  })

  it('toma la última rama y el título del primer prompt', () => {
    expect(stats.gitBranch).toBe('feature/x')
    expect(resolveTitle(stats)).toEqual({
      title: expect.stringMatching(/^Hola, esto es una prueba de título.*…$/),
      source: 'prompt'
    })
  })

  it('en dos tandas da el mismo resultado que de una vez', async () => {
    const chunk = await readJsonl(CORRUPTA)
    const split = new SessionAccumulator()
    split.addAll(chunk.records.slice(0, 4))
    split.addChunk({ records: chunk.records.slice(4), line: chunk.line })
    expect(split.stats()).toEqual(stats)
    expect(split.items).toEqual(acc.items)
    expect(split.usage).toEqual(acc.usage)
  })
})

describe('mensajes plegados a mitad de turno', () => {
  /** Sesión grabada con el SDK (tarea 1): un «Enviar ya» plegado tras el `Bash`. */
  const COLA = join(
    __dirname,
    '../fixtures/sdk/chat-cola.disco/577c3a2c-1bc3-4da3-9574-674979cc7030.jsonl'
  )

  function attachment(line: number, attachment: Record<string, unknown>): JsonlRecord {
    return {
      line,
      value: {
        type: 'attachment',
        uuid: `00000000-0000-4000-8000-00000000000${line}`,
        timestamp: '2026-10-14T10:00:00.000Z',
        isSidechain: false,
        attachment
      }
    }
  }

  it('queued_command de un prompt → user-prompt en cola con su sourceUuid', async () => {
    const acc = await parse(COLA)
    const queued = acc.items.filter((i) => i.kind === 'user-prompt' && i.queued)
    expect(queued).toEqual([
      expect.objectContaining({
        kind: 'user-prompt',
        text: 'Además, dime cuánto es 2+2.',
        images: 0,
        queued: true,
        sourceUuid: 'c0493f1f-6269-42dc-a0a4-0275f4292769'
      })
    ])
    // Cuenta como prompt: 1 inicial + 1 plegado + 2 de la cola de la app.
    expect(acc.stats().promptCount).toBe(4)
    expect(
      acc.items.filter((i) => i.kind === 'attachment' && i.attachmentType === 'queued_command')
    ).toEqual([])
  })

  it('caso de la terminal: notificación de tarea, prompt con bloques y prompt sin texto', () => {
    const acc = new SessionAccumulator()
    acc.addAll([
      attachment(1, {
        type: 'queued_command',
        commandMode: 'task-notification',
        prompt:
          '<task-notification>\n<status>killed</status>\n<summary>Parado</summary>\n</task-notification>',
        source_uuid: '00000000-0000-4000-8000-0000000000aa'
      }),
      attachment(2, {
        type: 'queued_command',
        commandMode: 'prompt',
        prompt: [
          { type: 'text', text: 'Mira esto' },
          { type: 'image', source: {} }
        ]
      }),
      attachment(3, { type: 'queued_command', prompt: { raro: true } }),
      attachment(4, { type: 'queued_command', prompt: '   ' })
    ])
    expect(acc.items.map((i) => i.kind)).toEqual([
      'task-notification',
      'user-prompt',
      'attachment',
      'attachment'
    ])
    expect(acc.items[1]).toMatchObject({ text: 'Mira esto', images: 1, queued: true })
    expect(acc.items[1]).not.toHaveProperty('sourceUuid')
    expect(acc.stats()).toMatchObject({ promptCount: 1, firstPrompt: 'Mira esto' })
  })
})

describe('avisos de límite y coste', () => {
  const at = (n: number): string => `2026-10-14T16:00:0${n}.000Z`
  type ValueRecord = Extract<JsonlRecord, { value: unknown }> & { value: Record<string, unknown> }
  const rateLimit = (n: number, extra: Record<string, unknown>): ValueRecord => ({
    line: n,
    value: {
      type: 'assistant',
      uuid: `rl${n}`,
      timestamp: at(n),
      error: 'rate_limit',
      message: {
        id: `m${n}`,
        model: '<synthetic>',
        role: 'assistant',
        content: [{ type: 'text', text: "You've hit your session limit · resets 9:30pm" }]
      },
      ...extra
    }
  })
  const cost = (n: number, startTime: unknown, total: unknown, extra = {}): JsonlRecord => ({
    line: n,
    value: { type: 'cost-state', startTime, totalCostUSD: total, ...extra }
  })
  const dated = (n: number): JsonlRecord => ({
    line: n,
    value: { type: 'system', subtype: 'turn_duration', timestamp: at(n) }
  })

  it('lee el aviso real con su ventana y renovación, sin uso', async () => {
    const acc = await parse(LIMITE)
    expect(acc.limitHits).toEqual([
      {
        line: 6,
        timestamp: '2026-10-14T16:39:04.333Z',
        kind: 'five_hour',
        status: 'rejected',
        resetsAt: '2026-10-14T19:30:00.000Z'
      }
    ])
    expect(acc.usage.every((event) => event.model !== '<synthetic>')).toBe(true)
    expect(acc.stats().diagnostics.unknownLineTypes).toEqual({})
  })

  it('guarda el coste acumulado con la fecha de la línea anterior', async () => {
    const acc = await parse(LIMITE)
    expect(acc.costPoints).toEqual([
      {
        startTime: 1791989396238,
        totalUsd: 41.623131400000005,
        timestamp: '2026-10-14T18:20:18.766Z',
        unknownModel: false
      }
    ])
  })

  it('una continuación arrastra el total del mismo proceso', async () => {
    const a = (await parse(CONTINUADA)).costPoints
    const b = (await parse(CONTINUACION)).costPoints
    expect(a.at(-1)?.startTime).toBe(b[0]?.startTime)
    expect(b[0]?.totalUsd).toBeGreaterThan(a.at(-1)?.totalUsd ?? Infinity)
  })

  it('usa la otra fuente del aviso y marca lo desconocido', () => {
    const acc = new SessionAccumulator().addAll([
      rateLimit(1, {
        apiErrorParams: {
          rate_limit_info: { status: 'rejected', resetsAt: 1792006200, rateLimitType: 'seven_day' }
        }
      }),
      rateLimit(2, { quotaLimits: { status: 'raro', rateLimitType: 'nuevo', resetsAt: 'x' } }),
      rateLimit(3, {})
    ])
    expect(acc.limitHits).toEqual([
      {
        line: 1,
        timestamp: at(1),
        kind: 'seven_day',
        status: 'rejected',
        resetsAt: '2026-10-14T19:30:00.000Z'
      },
      { line: 2, timestamp: at(2), kind: 'unknown', status: 'unknown' },
      { line: 3, timestamp: at(3), kind: 'unknown', status: 'unknown' }
    ])
  })

  it('ignora otros errores, mensajes reales, subagentes y avisos sin fecha', () => {
    const real = rateLimit(1, { quotaLimits: { status: 'rejected' } })
    ;(real.value as { message: { model: string } }).message.model = 'claude-opus-5-5'
    const other = rateLimit(2, { error: 'overloaded' })
    const noDate = rateLimit(3, {})
    delete (noDate.value as { timestamp?: string }).timestamp
    expect(new SessionAccumulator().addAll([real, other, noDate]).limitHits).toEqual([])
    const sub = new SessionAccumulator({ agentId: 'a1' }).addAll([rateLimit(4, {})])
    expect(sub.limitHits).toEqual([])
  })

  it('un punto por total nuevo de cada proceso; descarta valores deformados', () => {
    const acc = new SessionAccumulator().addAll([
      cost(1, 100, 0.5),
      dated(2),
      cost(3, 100, 0.5),
      cost(4, 100, 0.75, { hasUnknownModelCost: true }),
      cost(5, 200, 0.75),
      cost(6, '100', 1),
      cost(7, 100, -1),
      cost(8, 100, Number.NaN),
      cost(9, 100, '2')
    ])
    expect(acc.costPoints).toEqual([
      { startTime: 100, totalUsd: 0.5, unknownModel: false },
      { startTime: 100, totalUsd: 0.75, timestamp: at(2), unknownModel: true },
      { startTime: 200, totalUsd: 0.75, timestamp: at(2), unknownModel: false }
    ])
    expect(acc.stats().diagnostics.unknownLineTypes).toEqual({})
  })

  it('sobrevive a snapshot y restore a mitad de archivo', () => {
    const records = [
      dated(1),
      cost(2, 100, 0.5),
      rateLimit(3, { quotaLimits: { status: 'rejected', resetsAt: 1792006200 } }),
      cost(4, 100, 0.5),
      cost(5, 100, 0.9)
    ]
    const whole = new SessionAccumulator().addAll(records)
    const first = new SessionAccumulator().addAll(records.slice(0, 3))
    const restored = SessionAccumulator.restore(
      JSON.parse(JSON.stringify(first.snapshot()))
    ) as SessionAccumulator
    restored.addAll(records.slice(3))
    expect(restored.costPoints).toEqual(whole.costPoints)
    expect(restored.limitHits).toEqual(whole.limitHits)
    expect(restored.costPoints).toHaveLength(2)
    expect(restored.costPoints[1]?.timestamp).toBe(at(3))
  })
})

describe('compareVersions', () => {
  it('ordena numéricamente', () => {
    expect(['2.1.10', '2.1.9', '2.0.300'].sort(compareVersions)).toEqual([
      '2.0.300',
      '2.1.9',
      '2.1.10'
    ])
  })
})
