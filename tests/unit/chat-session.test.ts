import { describe, expect, it } from 'vitest'
import { ChatSession, type ChatSessionDeps } from '../../src/main/services/chat/chat-session'
import type { ChatEvent, PermissionRequestView, TaskView } from '../../src/shared/chat'
import {
  emitUntil,
  events,
  fakeFactory,
  flush,
  isResult,
  pushes,
  replay,
  type FakeQuery
} from './chat-fake-query'

const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }

function setup(init: Partial<ConstructorParameters<typeof ChatSession>[0]> = {}): {
  session: ChatSession
  log: ChatEvent[]
  queries: FakeQuery[]
  turnEnds: number[]
  catalogs: unknown[]
} {
  const { factory, queries } = fakeFactory()
  const log: ChatEvent[] = []
  const turnEnds: number[] = []
  const catalogs: unknown[] = []
  const deps: ChatSessionDeps = {
    query: factory,
    base: { includePartialMessages: true, settingSources: ['user', 'project', 'local'] },
    emit: (e) => log.push(e),
    onTurnEnd: () => turnEnds.push(Date.now()),
    onCatalog: (c) => catalogs.push(c),
    log: quiet,
    closeGraceMs: 0
  }
  const session = new ChatSession({ cwd: 'C:\\proyecto', ...init }, deps)
  return { session, log, queries, turnEnds, catalogs }
}

const statuses = (log: ChatEvent[]): string[] =>
  events(log, 'status').map((e) => (e as { status: string }).status)

describe('ChatSession con los fixtures', () => {
  it('edición: arranque, permisos (una vez, siempre, denegar) y fin de turno', async () => {
    const { session, log, queries, turnEnds, catalogs } = setup({ mode: 'default' })
    const [first] = pushes('edicion')
    session.send(first!.text, first!.uuid)
    await flush()
    const fake = queries[0]!
    expect(fake.options).toMatchObject({
      cwd: 'C:\\proyecto',
      permissionMode: 'default',
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true
    })
    expect(fake.options.resume).toBeUndefined()
    expect(fake.received.map((m) => m.uuid)).toEqual([first!.uuid])

    const decisions = ['allow', 'always', 'deny'] as const
    let n = 0
    await emitUntil(fake, replay('edicion'), isResult, async () => {
      const request = (events(log, 'permission').at(-1) as { request: PermissionRequestView })
        .request
      expect(session.status).toBe('waiting')
      session.respond({ requestId: request.requestId, decision: decisions[n++]!, scope: 'session' })
    })
    await flush()

    expect(n).toBe(3)
    const resolved = events(log, 'permission-resolved').map(
      (e) => (e as { decision: string }).decision
    )
    expect(resolved).toEqual(['allowed', 'always', 'denied'])
    // «Siempre» con setMode pasa la sesión a Aceptar ediciones.
    expect(session.mode).toBe('acceptEdits')
    expect(events(log, 'session')[0]).toMatchObject({
      sessionId: '87b26aad-df9e-441f-8b3b-5753ccdc17cb',
      model: 'claude-haiku-5-5'
    })
    expect(session.sessionId).toBe('87b26aad-df9e-441f-8b3b-5753ccdc17cb')
    expect(statuses(log)).toEqual([
      'starting',
      'working',
      'waiting',
      'working',
      'waiting',
      'working',
      'waiting',
      'working',
      'idle'
    ])
    expect(events(log, 'turn-end')).toEqual([
      expect.objectContaining({ kind: 'turn-end', result: 'success' })
    ])
    expect(turnEnds).toHaveLength(1)
    expect(catalogs).toHaveLength(1)

    const snap = session.snapshot()
    // Prompt entregado (de command_lifecycle), herramientas, texto y «Trabajó durante».
    expect(snap.live[0]).toMatchObject({
      kind: 'user-prompt',
      uuid: first!.uuid,
      text: first!.text
    })
    expect(snap.live.some((i) => i.kind === 'assistant-text')).toBe(true)
    expect(snap.live.at(-1)).toMatchObject({ kind: 'system', subtype: 'turn_duration' })
    expect(snap.draft).toBeNull()
    // La actividad se vio durante el turno y se borra al terminarlo.
    expect(events(log, 'activity').length).toBeGreaterThan(0)
    expect(snap.activity).toBeNull()
    expect(snap.permissions).toEqual([])
    expect(Object.values(snap.decisions)).toEqual(['allowed', 'always', 'denied'])
    // Los seq crecen de uno en uno y el snapshot lleva el último.
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1))
    expect(snap.seq).toBe(log.length)
  })

  it('cola: «enviar ya» con priority next, cola entregada de una en una al terminar', async () => {
    const { session, log, queries } = setup()
    const [a, b, c, d] = pushes('cola')
    session.send(a!.text, a!.uuid)
    await flush()
    const fake = queries[0]!
    const r = replay('cola')
    await emitUntil(fake, r, (l) => l['type'] === 'assistant')
    session.send(b!.text, b!.uuid, true)
    session.send(c!.text, c!.uuid)
    session.send(d!.text, d!.uuid)
    await flush()
    expect(fake.received.map((m) => [m.uuid, m.priority])).toEqual([
      [a!.uuid, undefined],
      [b!.uuid, 'next']
    ])
    expect(session.snapshot().queue.map((q) => q.state)).toEqual(['sending', 'queued', 'queued'])

    await emitUntil(fake, r, isResult)
    await flush()
    // El prompt en vivo llega antes que la cola sin él: el mensaje pendiente no parpadea.
    const bItems = log.findIndex(
      (e) => e.kind === 'items' && e.items.some((i) => i.uuid === b!.uuid)
    )
    const bQueued = log.findIndex(
      (e) => e.kind === 'queue' && e.queue.some((q) => q.uuid === b!.uuid)
    )
    const bQueue = log.findIndex(
      (e, i) => i > bQueued && e.kind === 'queue' && !e.queue.some((q) => q.uuid === b!.uuid)
    )
    expect(bItems).toBeGreaterThan(-1)
    expect(bQueue).toBeGreaterThan(bItems)
    const delivered = events(log, 'delivered')
    expect(delivered).toEqual([
      expect.objectContaining({ uuid: a!.uuid, queued: false }),
      expect.objectContaining({ uuid: b!.uuid, queued: true })
    ])
    // Al terminar el turno se entrega solo el primero de la cola.
    expect(fake.received.map((m) => m.uuid)).toEqual([a!.uuid, b!.uuid, c!.uuid])
    // El entregado sigue «Enviando…» hasta que Claude lo recibe.
    expect(session.snapshot().queue).toEqual([
      { uuid: c!.uuid, text: c!.text, state: 'sending' },
      { uuid: d!.uuid, text: d!.text, state: 'queued' }
    ])
    const plegado = session.snapshot().live.find((i) => i.uuid === b!.uuid)
    expect(plegado).toMatchObject({ kind: 'user-prompt', queued: true, sourceUuid: b!.uuid })

    await emitUntil(fake, r, isResult)
    await flush()
    expect(fake.received.map((m) => m.uuid)).toEqual([a!.uuid, b!.uuid, c!.uuid, d!.uuid])
    await emitUntil(fake, r)
    await flush()
    expect(session.snapshot().queue).toEqual([])
    expect(events(log, 'turn-end').map((e) => (e as { result: string }).result)).toEqual([
      'success',
      'success',
      'success'
    ])
    expect(session.status).toBe('idle')
  })

  it('interrupción: «interrupted» (no error) y la cola se conserva', async () => {
    const { session, log, queries } = setup()
    const [a, vale] = pushes('interrupcion')
    session.send(a!.text, a!.uuid)
    await flush()
    const fake = queries[0]!
    const r = replay('interrupcion')
    await emitUntil(fake, r, (l) => l['event'] === 'interrupt')
    await session.interrupt()
    session.send(vale!.text, vale!.uuid)
    expect(fake.calls).toContain('interrupt')
    await emitUntil(fake, r, isResult)
    await flush()
    expect(events(log, 'turn-end').at(-1)).toMatchObject({ result: 'interrupted' })
    expect(events(log, 'error')).toEqual([])
    expect(session.snapshot().queue).toEqual([
      { uuid: vale!.uuid, text: vale!.text, state: 'queued' }
    ])
    expect(fake.received).toHaveLength(1)
    expect(session.status).toBe('idle')
    expect(session.snapshot().live.some((i) => i.kind === 'interrupted')).toBe(true)

    // El usuario la envía: en reposo se entrega como turno normal.
    session.queueSendNow(vale!.uuid)
    await flush()
    expect(fake.received.map((m) => [m.uuid, m.priority])).toEqual([
      [a!.uuid, undefined],
      [vale!.uuid, undefined]
    ])
    await emitUntil(fake, r)
    await flush()
    expect(events(log, 'turn-end').at(-1)).toMatchObject({ result: 'success' })
  })

  it('tareas: indicador, stopTask y turno sin prompt al terminar el subagente', async () => {
    const { session, log, queries } = setup()
    const [a] = pushes('tareas')
    session.send(a!.text, a!.uuid)
    await flush()
    const fake = queries[0]!
    const r = replay('tareas')
    await emitUntil(fake, r, isResult)
    await flush()
    expect(session.status).toBe('idle')
    const running = (events(log, 'tasks').at(-1) as { tasks: TaskView[] }).tasks
    expect(running.map((t) => [t.type, t.status])).toEqual([
      ['agent', 'running'],
      ['bash', 'running']
    ])
    // Con tareas vivas no se cierra por inactividad.
    expect(session.idleForClose).toBe(false)

    await emitUntil(fake, r, (l) => l['event'] === 'stopTask')
    await session.stopTask('bttyqmk4m')
    expect(fake.calls).toContain('stopTask:bttyqmk4m')
    await emitUntil(fake, r)
    await flush()

    expect(Object.keys(session.snapshot().liveSubagents)).toEqual([
      'toolu_01RCFSes148E8JyCRjwuNpiB'
    ])
    // El subagente trabajando no abre turno; la notificación sí (Claude responde solo).
    expect(events(log, 'turn-start')).toHaveLength(2)
    expect(events(log, 'turn-end')).toHaveLength(2)
    const final = (events(log, 'tasks').at(-1) as { tasks: TaskView[] }).tasks
    expect(final.map((t) => t.status).sort()).toEqual(['completed', 'stopped'])
    expect(session.idleForClose).toBe(true)
    await session.close()
  })

  it('pregunta: AskUserQuestion se responde con answers', async () => {
    const { session, log, queries } = setup()
    const [a] = pushes('pregunta')
    session.send(a!.text, a!.uuid)
    await flush()
    let answered: unknown
    await emitUntil(queries[0]!, replay('pregunta'), isResult, async (_line, result) => {
      const { request } = events(log, 'permission').at(-1) as { request: PermissionRequestView }
      expect(request.kind).toBe('question')
      const q = (request.input as { questions: { question: string }[] }).questions[0]!.question
      session.respond({ requestId: request.requestId, decision: 'allow', answers: { [q]: 'Azul' } })
      answered = await result
    })
    expect(answered).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: expect.any(Object) }
    })
  })
})

describe('ChatSession: proceso, modelo y modo', () => {
  it('si el proceso muere: closed + error, y el siguiente mensaje reanuda', async () => {
    const { session, log, queries } = setup()
    const [a] = pushes('edicion')
    session.send(a!.text, a!.uuid)
    await flush()
    await emitUntil(queries[0]!, replay('edicion'), (l) => l['type'] === 'assistant')
    queries[0]!.crash()
    await flush()
    expect(session.status).toBe('closed')
    expect(events(log, 'error').at(-1)).toMatchObject({ error: { code: 'process' } })
    expect(events(log, 'turn-end').at(-1)).toMatchObject({ result: 'interrupted' })

    session.send('Sigue')
    await flush()
    expect(queries).toHaveLength(2)
    expect(queries[1]!.options.resume).toBe('87b26aad-df9e-441f-8b3b-5753ccdc17cb')
  })

  it('el mensaje en reposo queda «Enviando…» hasta recibirse; si el proceso muere, vuelve a la cola', async () => {
    const { session, queries } = setup()
    const [a] = pushes('edicion')
    session.send(a!.text, a!.uuid)
    expect(session.snapshot().queue).toEqual([{ uuid: a!.uuid, text: a!.text, state: 'sending' }])
    await flush()
    queries[0]!.crash()
    await flush()
    expect(session.snapshot().queue).toEqual([{ uuid: a!.uuid, text: a!.text, state: 'queued' }])

    // Con el proceso nuevo, el `started` lo saca de la cola y entra como prompt.
    const { session: other, queries: q2 } = setup()
    other.send(a!.text, a!.uuid)
    await flush()
    await emitUntil(q2[0]!, replay('edicion'), (l) => l['type'] === 'assistant')
    expect(other.snapshot().queue).toEqual([])
    expect(other.snapshot().live[0]).toMatchObject({ kind: 'user-prompt', uuid: a!.uuid })
  })

  it('setModel y setMode llegan al SDK; el modo se emite', async () => {
    const { session, log, queries } = setup({ model: 'haiku' })
    session.send('hola')
    await flush()
    expect(queries[0]!.options.model).toBe('haiku')
    await session.setModel('sonnet')
    await session.setMode('plan')
    expect(queries[0]!.calls).toEqual(['setModel:sonnet', 'setPermissionMode:plan'])
    expect(events(log, 'mode').at(-1)).toMatchObject({ mode: 'plan' })
    expect(session.snapshot()).toMatchObject({ model: 'sonnet', mode: 'plan' })
  })

  it('«Saltar permisos» en reposo relanza con allowDangerouslySkipPermissions', async () => {
    const { session, queries } = setup()
    session.send('hola')
    await flush()
    await emitUntil(queries[0]!, replay('saltar'), isResult)
    await flush()
    expect(session.status).toBe('idle')
    await session.setMode('bypassPermissions')
    await flush()
    expect(queries[0]!.calls).not.toContain('setPermissionMode:bypassPermissions')
    expect(queries[0]!.inputClosed).toBe(true)
    session.send('otra')
    await flush()
    expect(queries[1]!.options).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      resume: 'ddc28c77-fa54-4fb2-b8c5-62b8124aa9d1'
    })
  })

  it('«Todo en esta sesión» con el turno en curso aprueba al momento y relanza al terminar', async () => {
    const { session, log, queries } = setup({ mode: 'default' })
    const [first] = pushes('edicion')
    session.send(first!.text, first!.uuid)
    await flush()
    const results: unknown[] = []
    let cards = 0
    await emitUntil(queries[0]!, replay('edicion'), isResult, async (_l, promise) => {
      const pending = session.snapshot().permissions
      if (pending.length > 0) {
        cards += 1
        session.respond({ requestId: pending[0]!.requestId, decision: 'all' })
      }
      results.push(await promise)
    })
    await flush()
    // Solo la primera llega a tarjeta; las demás se aprueban sin preguntar.
    expect(cards).toBe(1)
    expect(results).toHaveLength(3)
    for (const r of results) expect(r).toMatchObject({ behavior: 'allow' })
    expect(events(log, 'mode').at(-1)).toMatchObject({ mode: 'bypassPermissions' })
    expect(queries[0]!.calls).not.toContain('setPermissionMode:bypassPermissions')
    // Al terminar el turno se cierra el proceso y el siguiente mensaje lo relanza con el flag.
    expect(queries[0]!.inputClosed).toBe(true)
    session.send('otra')
    await flush()
    expect(queries[1]!.options).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true
    })
  })

  it('volver a «Preguntar» antes de terminar el turno anula el relanzamiento', async () => {
    const { session, queries } = setup({ mode: 'default' })
    const [first] = pushes('edicion')
    session.send(first!.text, first!.uuid)
    await flush()
    let step = 0
    const results: unknown[] = []
    await emitUntil(queries[0]!, replay('edicion'), isResult, async (_l, promise) => {
      step += 1
      if (step === 1) {
        await session.setMode('bypassPermissions')
      } else if (step === 2) {
        // Ya aprobada sin tarjeta.
        expect(session.snapshot().permissions).toHaveLength(0)
        await session.setMode('default')
      } else {
        const pending = session.snapshot().permissions
        expect(pending).toHaveLength(1)
        session.respond({ requestId: pending[0]!.requestId, decision: 'deny' })
      }
      results.push(await promise)
    })
    await flush()
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ behavior: 'allow' })
    expect(results[1]).toMatchObject({ behavior: 'allow' })
    expect(results[2]).toMatchObject({ behavior: 'deny' })
    expect(session.snapshot().mode).toBe('default')
    expect(queries[0]!.inputClosed).toBe(false)
  })

  it('sin modo elegido no fija `permissionMode`: Claude Code aplica `defaultMode`', async () => {
    const { session, queries } = setup({ resume: 'ddc28c77-fa54-4fb2-b8c5-62b8124aa9d1' })
    session.send('hola')
    await flush()
    expect(queries[0]!.options.permissionMode).toBeUndefined()
    expect(queries[0]!.options.extraArgs).toBeUndefined()
  })

  it('Claude en Chrome: lanza con --chrome, informa de la conexión y relanza al cambiar', async () => {
    const { session, log, queries } = setup({ chrome: true })
    session.send('hola')
    await flush()
    const first = queries[0]!
    expect(first.options.extraArgs).toEqual({ chrome: null })
    expect(session.snapshot().chrome).toEqual({ enabled: true, status: 'pending' })
    first.mcpServerStatus = async () => [{ name: 'claude-in-chrome', status: 'connected' }]
    await emitUntil(first, replay('saltar'), isResult)
    await flush()
    expect(session.snapshot().chrome).toEqual({ enabled: true, status: 'connected' })

    // En reposo: se cierra el proceso y el siguiente mensaje lo relanza sin el flag.
    session.setChrome(false)
    await flush()
    expect(first.inputClosed).toBe(true)
    expect(events(log, 'chrome').at(-1)).toMatchObject({ chrome: { enabled: false } })
    session.send('otra')
    await flush()
    expect(queries[1]!.options.extraArgs).toBeUndefined()
    expect(queries[1]!.options.resume).toBe('ddc28c77-fa54-4fb2-b8c5-62b8124aa9d1')
  })

  it('Claude en Chrome con un turno en curso se aplica al terminar el turno', async () => {
    const { session, queries } = setup()
    session.send('hola')
    await flush()
    const r = replay('saltar')
    session.setChrome(true)
    await flush()
    expect(queries[0]!.inputClosed).toBe(false)
    await emitUntil(queries[0]!, r, isResult)
    await flush()
    expect(queries[0]!.inputClosed).toBe(true)
    session.send('otra')
    await flush()
    expect(queries[1]!.options.extraArgs).toEqual({ chrome: null })
  })

  it('detener con un permiso pendiente lo cancela', async () => {
    const { session, log, queries } = setup()
    const [a] = pushes('edicion')
    session.send(a!.text, a!.uuid)
    await flush()
    let result: unknown
    await emitUntil(
      queries[0]!,
      replay('edicion'),
      (l) => l['event'] === 'canUseTool',
      async (_l, promise) => {
        await session.interrupt()
        result = await promise
      }
    )
    expect(result).toMatchObject({ behavior: 'deny' })
    expect(events(log, 'permission-resolved').at(-1)).toMatchObject({ decision: 'cancelled' })
    expect(session.pendingPermissions).toBe(0)
  })

  it('reconcile quita lo que ya está en disco (por uuid) y lo propio sin uuid tras el turno', async () => {
    const { session, queries } = setup()
    const [a] = pushes('pregunta')
    session.send(a!.text, a!.uuid)
    await flush()
    await emitUntil(queries[0]!, replay('pregunta'), isResult, (_l, p) => {
      void p
      const req = session.snapshot().permissions[0]!
      session.respond({ requestId: req.requestId, decision: 'deny' })
    })
    await flush()
    const live = session.snapshot().live
    const uuids = live.filter((i) => i.uuid).map((i) => i.uuid as string)
    session.reconcile(uuids.slice(0, 2))
    expect(session.snapshot().live.map((i) => i.uuid)).toEqual(uuids.slice(2))
    session.reconcile(uuids)
    expect(session.snapshot().live).toEqual([])
  })

  it('un mensaje con forma rara no rompe la sesión', async () => {
    const { session, queries } = setup()
    session.send('hola')
    await flush()
    queries[0]!.emit(null, 42, { type: 'nada' }, { type: 'assistant', message: 5 })
    await flush()
    expect(session.status).toBe('starting')
    queries[0]!.emit({
      type: 'system',
      subtype: 'init',
      session_id: '11111111-1111-4111-8111-111111111111',
      model: 'm',
      cwd: 'C:\\x'
    })
    await flush()
    expect(session.status).toBe('working')
  })
})
