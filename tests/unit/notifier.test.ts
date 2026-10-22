import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatEventBody, TaskView } from '../../src/shared/chat'
import { DEFAULT_NOTIFICATIONS, type NotificationSettings } from '../../src/shared/types'
import { createNotifier, formatDuration } from '../../src/main/services/notifier'

interface Harness {
  show: ReturnType<typeof vi.fn>
  send: (body: ChatEventBody, chatId?: string) => void
  state: { focused: boolean; settings: NotificationSettings }
  advance: (ms: number) => number
}

function setup(overrides: Partial<NotificationSettings> = {}, focused = false): Harness {
  let clock = 0
  const show = vi.fn()
  const state = { focused, settings: { ...DEFAULT_NOTIFICATIONS, ...overrides } }
  const notifier = createNotifier({
    settings: () => state.settings,
    focused: () => state.focused,
    titleOf: (id) => (id === 's1' ? 'Arreglar el login' : null),
    show,
    now: () => clock
  })
  let seq = 0
  const send = (body: ChatEventBody, chatId = 'c1'): void =>
    notifier.onChatEvent({ chatId, seq: seq++, ...body } as ChatEvent)
  send({ kind: 'session', sessionId: 's1', model: 'm', cwd: '/r' })
  return { show, send, state, advance: (ms: number) => (clock += ms) }
}

function task(status: TaskView['status'], background = true): TaskView {
  return { taskId: 't1', type: 'bash', description: 'npm test', background, status, startedAt: 0 }
}

describe('createNotifier', () => {
  it('fin de turno con éxito y con error; interrumpido no avisa', () => {
    const { show, send, advance } = setup()
    send({ kind: 'turn-end', durationMs: 134_000, result: 'success' })
    expect(show).toHaveBeenLastCalledWith({
      kind: 'turnEnd',
      title: 'Arreglar el login',
      body: 'Ha terminado · 2 min 14 s',
      sessionId: 's1'
    })
    advance(6000)
    send({ kind: 'turn-end', durationMs: 1, result: 'interrupted' })
    expect(show).toHaveBeenCalledTimes(1)
    send({ kind: 'turn-end', durationMs: 1, result: 'error' })
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Terminó con un error' }))
  })

  it('permiso, pregunta y plan', () => {
    const { show, send, advance } = setup()
    const request = { requestId: 'r', toolName: 'Bash', input: {}, alwaysLabels: [], createdAt: '' }
    send({ kind: 'permission', request: { ...request, kind: 'tool' } } as ChatEventBody)
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Pide permiso: Bash' }))
    advance(5000)
    send({ kind: 'permission', request: { ...request, kind: 'question' } } as ChatEventBody)
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Te hace una pregunta' }))
  })

  it('tareas en segundo plano solo al pasar de running a terminada o fallida', () => {
    const { show, send } = setup()
    send({ kind: 'tasks', tasks: [task('completed')] })
    expect(show).not.toHaveBeenCalled()
    send({ kind: 'tasks', tasks: [task('running')] })
    send({ kind: 'tasks', tasks: [task('completed')] })
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'tasks', body: 'Tarea terminada: npm test' })
    )
    show.mockClear()
    send({ kind: 'tasks', tasks: [{ ...task('running', false), taskId: 't2' }] })
    send({ kind: 'tasks', tasks: [{ ...task('failed', false), taskId: 't2' }] })
    expect(show).not.toHaveBeenCalled()
  })

  it('límite rechazado con hora de renovación', () => {
    const { show, send } = setup()
    send({
      kind: 'rate-limit',
      window: {
        kind: 'five_hour',
        utilization: 100,
        status: 'rejected',
        resetsAt: '2026-10-19T19:30:00Z',
        source: 'chat-event',
        observedAt: ''
      }
    } as ChatEventBody)
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'limit',
        body: expect.stringMatching(/^Límite alcanzado · se renueva a las \d\d:\d\d$/)
      })
    )
  })

  it('respeta ajustes, foco y el mínimo de 5 s; sesión desconocida', () => {
    const off = setup({ turnEnd: false })
    off.send({ kind: 'turn-end', durationMs: 1, result: 'success' })
    expect(off.show).not.toHaveBeenCalled()

    const all = setup({ enabled: false })
    all.send({ kind: 'turn-end', durationMs: 1, result: 'success' })
    expect(all.show).not.toHaveBeenCalled()

    const focused = setup({}, true)
    focused.send({ kind: 'turn-end', durationMs: 1, result: 'success' })
    expect(focused.show).not.toHaveBeenCalled()
    focused.state.settings.whenFocused = true
    focused.send({ kind: 'turn-end', durationMs: 1, result: 'success' })
    expect(focused.show).toHaveBeenCalledTimes(1)
    focused.advance(4999)
    focused.send({ kind: 'turn-end', durationMs: 1, result: 'success' })
    expect(focused.show).toHaveBeenCalledTimes(1)

    const fresh = setup()
    fresh.send({ kind: 'turn-end', durationMs: 1, result: 'success' }, 'c2')
    expect(fresh.show).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Sesión nueva', sessionId: null })
    )
  })

  it('formatDuration', () => {
    expect(formatDuration(5_400)).toBe('5 s')
    expect(formatDuration(120_000)).toBe('2 min')
    expect(formatDuration(3_900_000)).toBe('1 h 5 min')
  })
})
