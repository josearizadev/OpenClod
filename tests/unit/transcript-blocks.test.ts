import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { listProjects, type SessionFileRef } from '../../src/main/services/claude-paths'
import { loadContinuation, loadSession } from '../../src/main/services/session-loader'
import {
  blockOfUuid,
  buildBlocks,
  diskIds,
  findAnchor,
  mergeLive,
  thinkingStepOf,
  type Block
} from '../../src/renderer/src/lib/transcript/blocks'
import type { TranscriptItem, TranscriptSegment } from '../../src/shared/sessions'

const FIXTURES = join(__dirname, '../fixtures/claude')
const ORIGIN = 'a55accdd-171f-4711-936e-b51294a4b423'
const CONTINUATION = '9c81d504-7ee7-4a60-a274-500078e29ce3'
const BIG = '0e56deca-67ad-4d7c-bc94-a61cc14540cd'
const PROGRAMAS = '3f010094-259d-4b05-80f2-637772220194'
const DEMO = '00000000-0000-4000-8000-000000000001'

const refs = new Map<string, SessionFileRef>()
const loaded = new Map<string, TranscriptItem[]>()

beforeAll(async () => {
  const listed = await listProjects(FIXTURES)
  if (!listed.ok) throw new Error(listed.reason)
  for (const project of listed.projects) {
    for (const ref of project.sessions) {
      refs.set(ref.sessionId, ref)
      loaded.set(ref.sessionId, (await loadSession(ref)).items)
    }
  }
})

const items = (id: string): TranscriptItem[] => loaded.get(id) ?? []
const ofKind = <K extends Block['kind']>(blocks: Block[], kind: K): Extract<Block, { kind: K }>[] =>
  blocks.filter((b): b is Extract<Block, { kind: K }> => b.kind === kind)
const NO_INTERNAL = { tools: true, thinking: true, internal: false }

describe('buildBlocks', () => {
  it('empareja cada tool-use con su resultado o lo marca sin resultado', () => {
    for (const id of loaded.keys()) {
      const all = items(id)
      const calls = ofKind(buildBlocks(all), 'tools').flatMap((b) => b.calls)
      expect(calls).toHaveLength(all.filter((i) => i.kind === 'tool-use').length)
      const results = new Set(all.flatMap((i) => (i.kind === 'tool-result' ? [i.toolUseId] : [])))
      for (const call of calls) {
        expect(call.status === 'missing').toBe(!results.has(call.id))
        if (call.result) expect(call.status).toBe(call.result.isError ? 'error' : 'ok')
      }
    }
    // La demo tiene un `Read` sin resultado.
    const demo = ofKind(buildBlocks(items(DEMO)), 'tools').flatMap((b) => b.calls)
    expect(demo).toMatchObject([{ name: 'Read', status: 'missing' }])
  })

  it('agrupa las llamadas consecutivas: los resultados, los adjuntos ocultos y el thinking vacío no cortan el grupo', () => {
    const blocks = buildBlocks(items(BIG), { filters: NO_INTERNAL })
    const groups = ofKind(blocks, 'tools')
    const calls = groups.flatMap((g) => g.calls)
    expect(groups.length).toBeLessThan(calls.length / 2)
    // Ningún grupo va seguido de otro: siempre hay algo visible en medio.
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i - 1]?.kind === 'tools' && blocks[i]?.kind === 'tools').toBe(false)
    }
  })

  it('subagentes colgados de su llamada `Agent`', () => {
    const calls = ofKind(buildBlocks(items(BIG)), 'tools').flatMap((b) => b.calls)
    const agents = calls.filter((c) => c.subagent)
    expect(agents.map((c) => c.subagent?.agentId).sort()).toEqual([
      'a45f6265eb93d3ccc',
      'a87cb1297b966067e'
    ])
    expect(agents.every((c) => c.name === 'Agent')).toBe(true)
  })

  it('«Pensó» vacío: fundido, absorbido delante de herramientas y visible delante de texto', () => {
    const all = items(BIG)
    const blocks = buildBlocks(all)
    const thinking = ofKind(blocks, 'thinking')
    const empty = all.filter((i) => i.kind === 'thinking' && i.text.trim() === '').length
    expect(thinking.length).toBeLessThan(empty)
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i] as Block
      if (b.kind !== 'thinking' || b.text !== '') continue
      expect(blocks[i + 1]?.kind).not.toBe('tools')
      expect(blocks[i + 1]?.kind).not.toBe('thinking')
    }

    const synthetic: TranscriptItem[] = [
      { kind: 'thinking', text: '', line: 1, sidechain: false },
      { kind: 'thinking', text: '', line: 2, sidechain: false },
      { kind: 'assistant-text', text: 'Hola', line: 3, sidechain: false },
      { kind: 'thinking', text: '', line: 4, sidechain: false },
      { kind: 'tool-use', id: 't', name: 'Bash', input: {}, line: 5, sidechain: false },
      { kind: 'thinking', text: '', line: 6, sidechain: false },
      { kind: 'tool-use', id: 'u', name: 'Read', input: {}, line: 7, sidechain: false },
      { kind: 'thinking', text: 'Razono', line: 8, sidechain: false }
    ]
    // El thinking con texto tras las llamadas entra en el grupo.
    expect(buildBlocks(synthetic).map((b) => b.kind)).toEqual(['thinking', 'assistant', 'tools'])
    const group = ofKind(buildBlocks(synthetic), 'tools')[0]
    expect(group?.calls).toHaveLength(2)
    expect(group?.steps.map((s) => (s.kind === 'call' ? s.call.id : s.text))).toEqual([
      't',
      'u',
      'Razono'
    ])
  })

  it('grupo de actividad: thinking y llamadas juntos hasta un texto o un prompt', () => {
    const t = (line: number, text: string): TranscriptItem => ({
      kind: 'thinking',
      text,
      line,
      uuid: `th${line}`,
      sidechain: false
    })
    const call = (line: number, id: string): TranscriptItem => ({
      kind: 'tool-use',
      id,
      name: 'Bash',
      input: { command: id },
      line,
      uuid: `tu${line}`,
      sidechain: false
    })
    const synthetic: TranscriptItem[] = [
      t(1, 'Primero miro'),
      call(2, 'a'),
      t(3, 'Ahora otro'),
      call(4, 'b'),
      t(5, ''),
      call(6, 'c'),
      { kind: 'assistant-text', text: 'Listo', line: 7, sidechain: false },
      t(8, 'Sigo'),
      call(9, 'd'),
      { kind: 'user-prompt', text: 'Vale', images: 0, line: 10, sidechain: false },
      t(11, 'Solo pienso'),
      { kind: 'assistant-text', text: 'Fin', line: 12, sidechain: false }
    ]
    const blocks = buildBlocks(synthetic)
    expect(blocks.map((b) => b.kind)).toEqual([
      'tools',
      'assistant',
      'tools',
      'user',
      'thinking',
      'assistant'
    ])
    const [first, second] = ofKind(blocks, 'tools')
    // Clave del primer thinking: la misma que tenía suelto antes de llegar la llamada.
    expect(first?.key).toBe('th1:0')
    expect(first?.steps.map((s) => (s.kind === 'call' ? s.call.id : s.text))).toEqual([
      'Primero miro',
      'a',
      'Ahora otro',
      'b',
      'c'
    ])
    expect(second?.calls.map((c) => c.id)).toEqual(['d'])
    // Buscar un thinking del grupo lleva al grupo.
    expect(blockOfUuid(blocks, 'th3')?.key).toBe('th1:0')
    expect(thinkingStepOf(first as Block, 'th3')).toBe('th3:0')
  })

  it('mensajes pendientes al final, con la clave que tendrá el prompt', () => {
    const base: TranscriptItem[] = [
      { kind: 'assistant-text', text: 'Hola', line: 1, uuid: 'x', sidechain: false }
    ]
    const pending = [{ uuid: 'p1', text: 'Otra cosa', images: 1 }]
    const before = buildBlocks(base, { live: { running: true, pending } })
    expect(before.at(-1)).toMatchObject({
      kind: 'user',
      key: 'p1:0',
      text: 'Otra cosa',
      images: 1,
      pending: true
    })
    const delivered: TranscriptItem[] = [
      ...base,
      { kind: 'user-prompt', text: 'Otra cosa', images: 1, line: 2, uuid: 'p1', sidechain: false }
    ]
    const after = buildBlocks(delivered, { live: { running: true, pending } })
    expect(after.filter((b) => b.kind === 'user')).toHaveLength(1)
    expect(after.at(-1)).toMatchObject({ key: 'p1:0' })
    expect(after.at(-1)).not.toHaveProperty('pending')
  })

  it('comando con su salida y duración del turno', () => {
    const synthetic: TranscriptItem[] = [
      { kind: 'command', name: '/model', args: 'opus', line: 1, sidechain: false },
      { kind: 'command-output', text: 'Hecho', stream: 'stdout', line: 2, sidechain: false },
      { kind: 'command-output', text: 'Huérfana', stream: 'stderr', line: 3, sidechain: false },
      { kind: 'system', subtype: 'turn_duration', durationMs: 134_000, line: 4, sidechain: false }
    ]
    const blocks = buildBlocks(synthetic)
    expect(blocks[0]).toMatchObject({
      kind: 'command',
      name: '/model',
      output: { text: 'Hecho', stream: 'stdout' }
    })
    expect(blocks[1]).toMatchObject({ kind: 'internal', label: 'Salida de comando' })
    expect(blocks[2]).toMatchObject({ kind: 'duration', ms: 134_000 })
    const real = buildBlocks(items(PROGRAMAS), { filters: NO_INTERNAL })
    expect(ofKind(real, 'duration')).toHaveLength(9)
    expect(ofKind(real, 'notice').map((n) => n.variant)).toEqual(['task'])
  })

  it('sesión corrupta: los `unknown` salen como «Elemento no reconocido» solo con avisos internos', () => {
    const shown = ofKind(buildBlocks(items(DEMO)), 'internal')
    expect(shown.filter((b) => b.label.startsWith('Elemento no reconocido: '))).toHaveLength(4)
    expect(shown.map((b) => b.label)).toContain('Elemento no reconocido: future_block')
    expect(ofKind(buildBlocks(items(DEMO), { filters: NO_INTERNAL }), 'internal')).toHaveLength(0)
    // El resto se ve igual.
    expect(ofKind(buildBlocks(items(DEMO), { filters: NO_INTERNAL }), 'assistant')).toHaveLength(2)
  })

  it('filtros: herramientas, thinking y avisos internos', () => {
    const all = items(BIG)
    const none = buildBlocks(all, { filters: { tools: false, thinking: false, internal: false } })
    expect(ofKind(none, 'tools')).toHaveLength(0)
    expect(ofKind(none, 'thinking')).toHaveLength(0)
    expect(ofKind(none, 'internal')).toHaveLength(0)
    expect(ofKind(none, 'user')).toHaveLength(ofKind(buildBlocks(all), 'user').length)
    expect(ofKind(none, 'assistant').length).toBe(ofKind(buildBlocks(all), 'assistant').length)
    const withInternal = buildBlocks(all)
    expect(ofKind(withInternal, 'internal').length).toBeGreaterThan(197)
  })

  it('claves estables y únicas entre filtros', () => {
    const all = items(BIG)
    const full = buildBlocks(all)
    const keys = full.map((b) => b.key)
    expect(new Set(keys).size).toBe(keys.length)
    const byKey = new Map(full.map((b) => [b.key, b]))
    for (const b of buildBlocks(all, { filters: NO_INTERNAL })) {
      if (b.kind === 'tools' || b.kind === 'separator') continue
      expect(byKey.get(b.key)).toEqual(b)
    }
  })

  it('separadores de fecha cuando cambia el día', () => {
    const at = (line: number, iso: string): TranscriptItem => ({
      kind: 'user-prompt',
      text: String(line),
      images: 0,
      line,
      sidechain: false,
      timestamp: iso
    })
    const blocks = buildBlocks([
      at(1, '2026-10-12T10:00:00'),
      at(2, '2026-10-12T18:00:00'),
      at(3, '2026-10-13T09:00:00')
    ])
    expect(blocks.map((b) => (b.kind === 'separator' ? b.variant : b.kind))).toEqual([
      'date',
      'user',
      'user',
      'date',
      'user'
    ])
  })

  it('continuación: «Reanudada aquí» antes de la primera línea propia', async () => {
    const ref = refs.get(CONTINUATION) as SessionFileRef
    const previous = refs.get(ORIGIN) as SessionFileRef
    const continuation = await loadContinuation(ref, previous)
    const until = continuation.summary.inheritedUntilLine as number
    const own = continuation.items.find((i) => i.line > until) as TranscriptItem
    const segments: TranscriptSegment[] = [
      { sessionId: ORIGIN, firstLine: continuation.items[0]?.line ?? 1 },
      { sessionId: CONTINUATION, firstLine: own.line, startedAt: own.timestamp }
    ]
    const blocks = buildBlocks(continuation.items, { segments, filters: NO_INTERNAL })
    const resumed = blocks.findIndex((b) => b.kind === 'separator' && b.variant === 'resumed')
    expect(resumed).toBeGreaterThan(0)
    expect(blocks.filter((b) => b.kind === 'separator' && b.variant === 'resumed')).toHaveLength(1)
    expect(blocks[resumed]).toMatchObject({ segment: 1, date: own.timestamp })
    expect(blocks.slice(0, resumed).every((b) => b.segment === 0)).toBe(true)
    expect(blocks.slice(resumed).every((b) => b.segment === 1)).toBe(true)
  })

  it('findAnchor: la clave exacta o el bloque anterior por línea', () => {
    const blocks = buildBlocks(items(BIG), { filters: NO_INTERNAL })
    const target = blocks[40] as Block
    expect(findAnchor(blocks, target.key, target.line)).toBe(40)
    const index = findAnchor(blocks, 'ya-no-está', target.line + 0.5)
    expect((blocks[index] as Block).line).toBeLessThanOrEqual(target.line + 0.5)
    expect((blocks[index + 1] as Block | undefined)?.line ?? Infinity).toBeGreaterThan(target.line)
  })

  it('rendimiento: la sesión de 1.159 líneas en menos de 20 ms', () => {
    const all = items(BIG)
    buildBlocks(all)
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) buildBlocks(all, { filters: NO_INTERNAL })
    expect((performance.now() - t0) / 5).toBeLessThan(20)
  })
})

describe('buildBlocks con chat en vivo', () => {
  /** Mensajes reales del SDK del fixture `cola` y su JSONL de disco (tarea 1). */
  async function cola(): Promise<{ live: TranscriptItem[]; disk: TranscriptItem[] }> {
    const { SdkMapper } = await import('../../src/main/services/chat/chat-mapper')
    const { sdkMessages, diskFile } = await import('./chat-fixtures')
    const { sessionRefFromFile } = await import('../../src/main/services/claude-paths')
    const mapper = new SdkMapper()
    const live: TranscriptItem[] = []
    for (const msg of sdkMessages('cola')) {
      for (const e of mapper.map(msg)) if (e.kind === 'items') live.push(...e.items)
    }
    const disk = (await loadSession(await sessionRefFromFile(diskFile('cola')))).items
    return { live, disk }
  }

  it('las claves salen del uuid: el bloque en vivo y el de disco tienen la misma', async () => {
    const { live, disk } = await cola()
    const liveKeys = new Set(buildBlocks(live).map((b) => b.key))
    const diskBlocks = buildBlocks(disk)
    const shared = diskBlocks.filter((b) => liveKeys.has(b.key))
    expect(shared.length).toBeGreaterThan(3)
    for (const b of buildBlocks(live)) {
      if (b.kind === 'separator') continue
      expect(b.key).toMatch(/^[0-9a-f-]{36}:\d+$/)
    }
  })

  it('mergeLive no duplica lo que ya está en disco (uuid y prompt plegado por sourceUuid)', async () => {
    const { live, disk } = await cola()
    // Prompt plegado como lo crea la sesión: uuid propio = sourceUuid del queued_command.
    const folded: TranscriptItem = {
      line: 2_000_000,
      uuid: 'c0493f1f-6269-42dc-a0a4-0275f4292769',
      sidechain: false,
      kind: 'user-prompt',
      text: 'Además, dime cuánto es 2+2.',
      images: 0,
      queued: true,
      sourceUuid: 'c0493f1f-6269-42dc-a0a4-0275f4292769'
    }
    const merged = mergeLive(disk, [...live, folded])
    expect(merged).toHaveLength(disk.length)
    expect(diskIds(disk).has('c0493f1f-6269-42dc-a0a4-0275f4292769')).toBe(true)
    // El plegado tiene en vivo y en disco la misma clave de bloque.
    const key = (list: TranscriptItem[]): string | undefined =>
      buildBlocks(list).find((b) => b.kind === 'user' && b.text.startsWith('Además'))?.key
    expect(key([folded])).toBe(key(disk))
    // Lo que no está en disco se añade al final, y lo propio sin uuid también.
    const extra: TranscriptItem = {
      line: 2_000_001,
      sidechain: false,
      kind: 'system',
      subtype: 'turn_duration',
      durationMs: 5
    }
    expect(mergeLive(disk, [extra]).at(-1)).toBe(extra)
    expect(mergeLive(disk, [])).toBe(disk)
  })

  it('borrador en streaming como último bloque; herramientas en vivo «en ejecución»', () => {
    const items: TranscriptItem[] = [
      {
        line: 1_000_001,
        uuid: 'u1',
        sidechain: false,
        kind: 'user-prompt',
        text: 'Hola',
        images: 0
      },
      {
        line: 1_000_002,
        uuid: 'a1',
        sidechain: false,
        kind: 'tool-use',
        id: 't1',
        name: 'Bash',
        input: { command: 'sleep 5' }
      }
    ]
    const blocks = buildBlocks(items, {
      live: {
        running: true,
        progress: { t1: 3000 },
        decisions: { t1: 'allowed' },
        draft: { messageId: 'm1', text: 'Escribiendo **ya**' }
      }
    })
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'tools', 'assistant'])
    const tools = blocks[1] as Extract<Block, { kind: 'tools' }>
    expect(tools.calls[0]).toMatchObject({
      status: 'running',
      elapsedMs: 3000,
      decision: 'allowed'
    })
    expect(blocks[2]).toMatchObject({
      kind: 'assistant',
      streaming: true,
      text: 'Escribiendo **ya**',
      key: 'draft:m1'
    })
    // Sin trabajar, la misma llamada vuelve a ser «sin resultado»; las de disco nunca están en curso.
    expect(
      (buildBlocks(items, { live: { running: false } })[1] as Extract<Block, { kind: 'tools' }>)
        .calls[0]?.status
    ).toBe('missing')
    const diskCall: TranscriptItem = { ...(items[1] as TranscriptItem), line: 5 }
    expect(
      (buildBlocks([diskCall], { live: { running: true } })[0] as Extract<Block, { kind: 'tools' }>)
        .calls[0]?.status
    ).toBe('missing')
    // Borrador vacío: no se pinta.
    expect(
      buildBlocks(items, { live: { running: true, draft: { messageId: 'm', text: '  ' } } })
    ).toHaveLength(2)
  })
})

describe('transcript que crece', () => {
  it('añadir elementos conserva las claves y solo crece por el final', () => {
    const all = items(BIG)
    const filters = { tools: true, thinking: true, internal: true }
    const full = buildBlocks(all, { filters })
    for (const cut of [200, 400, 600]) {
      const partial = buildBlocks(all.slice(0, cut), { filters })
      // Todos los bloques salvo el último (que puede completarse) siguen con su clave.
      const stable = partial.slice(0, -1).map((b) => b.key)
      expect(full.slice(0, stable.length).map((b) => b.key)).toEqual(stable)
    }
  })

  it('un mensaje completado en líneas posteriores actualiza su bloque', () => {
    const all = items(BIG)
    const index = all.findIndex(
      (item, i) =>
        item.kind === 'assistant-text' &&
        item.messageId !== undefined &&
        all.slice(i + 1).some((n) => 'messageId' in n && n.messageId === item.messageId)
    )
    expect(index).toBeGreaterThan(-1)
    const filters = { tools: true, thinking: true, internal: true }
    const before = buildBlocks(all.slice(0, index + 1), { filters })
    const after = buildBlocks(all, { filters })
    const last = before.at(-1) as Block
    const same = after.find((b) => b.key === last.key)
    expect(same).toBeDefined()
  })
})

describe('salto a un mensaje', () => {
  const hidden = { tools: false, thinking: false, internal: false }

  it('reveal muestra un elemento filtrado sin cambiar el resto', () => {
    const all = items(BIG)
    const call = all.find((i) => i.kind === 'tool-use' && i.uuid)
    expect(call).toBeDefined()
    const uuid = call?.uuid as string
    const toolUseId = call?.kind === 'tool-use' ? call.id : ''
    const plain = buildBlocks(all, { filters: hidden })
    expect(ofKind(plain, 'tools')).toHaveLength(0)
    const revealed = buildBlocks(all, { filters: hidden, reveal: new Set([uuid]) })
    expect(blockOfUuid(revealed, uuid, { toolUseId })?.kind).toBe('tools')
    expect(ofKind(revealed, 'tools').flatMap((b) => b.calls.map((c) => c.id))).toContain(toolUseId)
    // El resto sigue filtrado.
    expect(ofKind(revealed, 'tools').length).toBeLessThan(
      ofKind(buildBlocks(all, { filters: NO_INTERNAL }), 'tools').length
    )
  })

  it('blockOfUuid: por clave, por llamada y null si no está', () => {
    const all = items(BIG)
    const blocks = buildBlocks(all, { filters: NO_INTERNAL })
    const prompt = all.find((i) => i.kind === 'user-prompt' && i.uuid)
    expect(blockOfUuid(blocks, prompt?.uuid as string)?.kind).toBe('user')
    const result = all.find((i) => i.kind === 'tool-result')
    if (result?.kind === 'tool-result') {
      const group = blockOfUuid(blocks, result.uuid ?? 'x', { toolUseId: result.toolUseId })
      expect(group?.kind).toBe('tools')
    }
    expect(blockOfUuid(blocks, 'no-existe')).toBeNull()
  })
})
