import { describe, expect, it, vi } from 'vitest'
import {
  createDraftPacer,
  mapRunError,
  SdkMapper,
  type MappedEvent
} from '../../src/main/services/chat/chat-mapper'
import { sdkMessages, type ChatCase } from './chat-fixtures'

function mapAll(name: ChatCase): { events: MappedEvent[]; mapper: SdkMapper } {
  const mapper = new SdkMapper()
  const events = sdkMessages(name).flatMap((msg) => mapper.map(msg))
  return { events, mapper }
}

const kinds = (events: MappedEvent[]): string[] => events.map((e) => e.kind)

describe('SdkMapper con mensajes reales', () => {
  it('init → sesión, modelo, carpeta y modo', () => {
    const init = mapAll('edicion').events.find((e) => e.kind === 'init')
    expect(init).toEqual({
      kind: 'init',
      sessionId: '87b26aad-df9e-441f-8b3b-5753ccdc17cb',
      model: 'claude-haiku-5-5',
      cwd: expect.stringContaining('grabar'),
      mode: 'default'
    })
  })

  it('el borrador acumula el texto y lo sustituye el mensaje completo', () => {
    const { events } = mapAll('edicion')
    const drafts = events.filter((e) => e.kind === 'draft')
    expect(drafts.length).toBeGreaterThan(1)
    // Acumulado: cada borrador empieza por el anterior.
    for (let i = 1; i < drafts.length; i++) {
      const prev = drafts[i - 1] as { text: string; messageId: string }
      const cur = drafts[i] as { text: string; messageId: string }
      if (prev.messageId === cur.messageId) expect(cur.text.startsWith(prev.text)).toBe(true)
    }
    const last = drafts[drafts.length - 1] as { text: string }
    const clearAt = events.findIndex((e) => e.kind === 'draft-clear')
    const text = events
      .slice(0, clearAt)
      .flatMap((e) => (e.kind === 'items' ? e.items : []))
      .filter((i) => i.kind === 'assistant-text')
      .pop()
    expect(text && 'text' in text ? text.text : '').toBe(last.text)
  })

  it('content_block_start → actividad: pensar, escribir o herramienta', () => {
    const { events } = mapAll('tareas')
    const activities = events.flatMap((e) => (e.kind === 'activity' ? [e.activity] : []))
    expect(new Set(activities)).toEqual(new Set(['thinking', 'writing', 'tool']))
    // La actividad «writing» va antes que el primer borrador de ese bloque.
    const firstDraft = events.findIndex((e) => e.kind === 'draft')
    expect(
      events.slice(0, firstDraft).some((e) => e.kind === 'activity' && e.activity === 'writing')
    ).toBe(true)
  })

  it('command_lifecycle → lifecycle con el uuid del mensaje', () => {
    const { events } = mapAll('cola')
    const life = events.filter((e) => e.kind === 'lifecycle')
    expect(life).toContainEqual({
      kind: 'lifecycle',
      commandUuid: 'c0493f1f-6269-42dc-a0a4-0275f4292769',
      state: 'started'
    })
    expect(new Set(life.map((e) => (e as { state: string }).state))).toEqual(
      new Set(['queued', 'started', 'completed'])
    )
  })

  it('result: éxito, y error tras interrumpir con su detalle', () => {
    const results = mapAll('interrupcion').events.filter((e) => e.kind === 'result')
    expect(results[0]).toMatchObject({ subtype: 'error_during_execution', isError: true })
    expect(results[1]).toMatchObject({ subtype: 'success', isError: false })
    expect((results[1] as { durationMs: number }).durationMs).toBeGreaterThan(0)
  })

  it('task_* y background_tasks_changed pasan a tasks.ts', () => {
    const tasks = mapAll('tareas').events.filter((e) => e.kind === 'task')
    const subtypes = tasks.map(
      (e) => (e as { message: Record<string, unknown> }).message['subtype']
    )
    expect(new Set(subtypes)).toEqual(
      new Set([
        'task_started',
        'task_progress',
        'task_updated',
        'task_notification',
        'background_tasks_changed'
      ])
    )
  })

  it('subagente: sus elementos van aparte y no tocan el borrador principal', () => {
    const { events } = mapAll('tareas')
    expect(kinds(events)).toContain('subagent-items')
  })

  it('no cuenta como desconocido nada de los fixtures salvo lo que no se usa', () => {
    for (const name of ['edicion', 'cola', 'tareas', 'pregunta', 'plan'] as const) {
      expect(mapAll(name).mapper.unknown).toBe(0)
    }
  })
})

describe('SdkMapper con mensajes inventados', () => {
  it('ignora lo malformado sin lanzar y lo cuenta', () => {
    const mapper = new SdkMapper()
    expect(mapper.map(null)).toEqual([])
    expect(mapper.map('texto')).toEqual([])
    expect(mapper.map({ type: 'nuevo_tipo' })).toEqual([])
    expect(mapper.map({ type: 'assistant', message: 'raro' })).toEqual([])
    expect(mapper.map({ type: 'stream_event', event: { type: 'content_block_delta' } })).toEqual([])
    expect(mapper.map({ type: 'command_lifecycle', state: 'raro', command_uuid: 'x' })).toEqual([])
    expect(mapper.unknown).toBe(3)
  })

  it('error de autenticación en un mensaje del asistente', () => {
    const mapper = new SdkMapper()
    const events = mapper.map({
      type: 'assistant',
      error: 'authentication_failed',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'Invalid API key' }] }
    })
    expect(events).toEqual([
      {
        kind: 'error',
        error: {
          code: 'auth',
          message: expect.stringContaining('`claude auth login`'),
          detail: 'authentication_failed: Invalid API key'
        }
      }
    ])
  })

  it('tool_progress en milisegundos', () => {
    expect(
      new SdkMapper().map({ type: 'tool_progress', tool_use_id: 't1', elapsed_time_seconds: 2.5 })
    ).toEqual([{ kind: 'tool-progress', toolUseId: 't1', elapsedMs: 2500 }])
  })

  it('result de error con errores en el detalle', () => {
    expect(
      new SdkMapper().map({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        duration_ms: 10,
        errors: ['uno', 'dos']
      })
    ).toEqual([
      {
        kind: 'result',
        subtype: 'error_max_turns',
        isError: true,
        durationMs: 10,
        detail: 'uno\ndos'
      }
    ])
  })
})

describe('mapRunError', () => {
  it('distingue abortado, CLI ausente, sesión no iniciada y proceso caído', () => {
    expect(mapRunError(new Error('x'), true)).toBeNull()
    expect(
      mapRunError(new Error('Claude Code native binary not found at C:\\x'), false)?.code
    ).toBe('cli-missing')
    expect(mapRunError(new Error('Not logged in · Please run /login'), false)?.code).toBe('auth')
    expect(mapRunError(new Error('Claude Code process exited with code 1'), false)?.code).toBe(
      'process'
    )
    expect(mapRunError('raro', false)).toEqual({
      code: 'unknown',
      message: expect.any(String),
      detail: 'raro'
    })
  })
})

describe('createDraftPacer', () => {
  it('el primero sale al momento y luego como mucho uno cada 50 ms con el último texto', () => {
    vi.useFakeTimers()
    try {
      const out: string[] = []
      const pacer = createDraftPacer((d) => out.push(d.text), 50)
      pacer.push({ messageId: 'm', text: 'a' })
      expect(out).toEqual(['a'])
      pacer.push({ messageId: 'm', text: 'ab' })
      pacer.push({ messageId: 'm', text: 'abc' })
      expect(out).toEqual(['a'])
      vi.advanceTimersByTime(50)
      expect(out).toEqual(['a', 'abc'])
      pacer.push({ messageId: 'm', text: 'abcd' })
      pacer.clear()
      vi.advanceTimersByTime(100)
      expect(out).toEqual(['a', 'abc'])
      pacer.push({ messageId: 'm', text: 'abcde' })
      expect(out).toEqual(['a', 'abc', 'abcde'])
      pacer.push({ messageId: 'm', text: 'abcdef' })
      pacer.flush()
      expect(out).toEqual(['a', 'abc', 'abcde', 'abcdef'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('rate_limit_event', () => {
  it('se traduce a rate-limit con la ventana normalizada', () => {
    const mapper = new SdkMapper()
    const events = mapper.map({
      type: 'rate_limit_event',
      uuid: 'u',
      session_id: 's',
      rate_limit_info: {
        status: 'allowed_warning',
        resetsAt: 1792006200,
        rateLimitType: 'five_hour',
        utilization: 85
      }
    })
    expect(events).toMatchObject([
      {
        kind: 'rate-limit',
        window: {
          kind: 'five_hour',
          status: 'allowed_warning',
          utilization: 85,
          resetsAt: '2026-10-14T19:30:00.000Z',
          source: 'chat-event'
        }
      }
    ])
    expect(mapper.unknown).toBe(0)
  })

  it('una forma inesperada no produce eventos', () => {
    const mapper = new SdkMapper()
    expect(mapper.map({ type: 'rate_limit_event', rate_limit_info: { status: 'raro' } })).toEqual(
      []
    )
  })
})
