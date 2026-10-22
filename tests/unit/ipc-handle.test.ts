import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>
const listeners = new Map<string, Listener>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Listener) => listeners.set(channel, listener)
  }
}))
vi.mock('../../src/main/window', () => ({
  isAppUrl: (url: string) => url.startsWith('http://localhost:5173')
}))
vi.mock('../../src/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { handle, IpcError } = await import('../../src/main/ipc/handle')
const { logger } = await import('../../src/main/services/logger')

function eventFrom(url: string | null): IpcMainInvokeEvent {
  return { senderFrame: url === null ? null : { url } } as unknown as IpcMainInvokeEvent
}
const trusted = eventFrom('http://localhost:5173/#/diagnostico')

function register(fn: Parameters<typeof handle<'system:ping'>>[1]): Listener {
  handle('system:ping', fn)
  const listener = listeners.get('system:ping')
  if (!listener) throw new Error('canal no registrado')
  return listener
}

beforeEach(() => {
  listeners.clear()
  vi.clearAllMocks()
})

describe('handle()', () => {
  it('con argumentos válidos ejecuta el handler y devuelve ok', async () => {
    const fn = vi.fn(({ msg }: { msg: string }) => ({ pong: msg }))
    const result = await register(fn)(trusted, { msg: 'hola' })
    expect(result).toEqual({ ok: true, data: { pong: 'hola' } })
    expect(fn).toHaveBeenCalledOnce()
  })

  it.each([
    ['sin argumentos', undefined],
    ['tipo incorrecto', { msg: 42 }],
    ['demasiado largo', { msg: 'x'.repeat(201) }],
    ['no es un objeto', 'hola']
  ])(
    'con argumentos inválidos (%s) devuelve INVALID_ARGS sin ejecutar el handler',
    async (_, raw) => {
      const fn = vi.fn()
      const result = await register(fn)(trusted, raw)
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } })
      expect((result as { error: { message: string } }).error.message).not.toBe('')
      expect(fn).not.toHaveBeenCalled()
    }
  )

  it('si el handler lanza devuelve INTERNAL genérico y lo registra en el log', async () => {
    const result = await register(() => {
      throw new Error('detalle interno')
    })(trusted, { msg: 'hola' })
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Error interno' } })
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('si el handler rechaza una promesa también devuelve INTERNAL', async () => {
    const result = await register(async () => Promise.reject(new Error('x')))(trusted, {
      msg: 'hola'
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
  })

  it('si el handler lanza un IpcError devuelve su código y mensaje sin registrarlo', async () => {
    const result = await register(() => {
      throw new IpcError('INVALID_CWD', 'La carpeta de trabajo no existe.')
    })(trusted, { msg: 'hola' })
    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_CWD', message: 'La carpeta de trabajo no existe.' }
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it.each([
    ['otro origen', 'https://example.com/'],
    ['sin frame', null]
  ])(
    'con remitente no confiable (%s) devuelve FORBIDDEN sin validar ni ejecutar',
    async (_, url) => {
      const fn = vi.fn()
      const result = await register(fn)(eventFrom(url), { msg: 'hola' })
      expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      expect(fn).not.toHaveBeenCalled()
    }
  )
})

describe('canales del chat', async () => {
  const { invokeContract } = await import('../../src/shared/ipc-contract')
  const SID = '87b26aad-df9e-441f-8b3b-5753ccdc17cb'
  const UUID = '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f'

  it.each([
    ['chat:start', { cwd: 'C:/p', text: 'hola', mode: 'plan', model: null }],
    ['chat:send', { sessionId: SID, text: 'hola', now: true }],
    ['chat:queueEdit', { sessionId: SID, uuid: UUID, text: 'otra' }],
    ['chat:permission', { sessionId: SID, requestId: UUID, decision: 'always', scope: 'project' }],
    ['chat:setMode', { sessionId: SID, mode: 'bypassPermissions' }],
    ['chat:setModel', { sessionId: SID, model: null }],
    ['chat:stopTask', { sessionId: SID, taskId: 'bttyqmk4m' }],
    ['chat:snapshot', { sessionId: SID }]
  ] as const)('%s acepta una entrada válida', (channel, raw) => {
    expect(invokeContract[channel].input.safeParse(raw).success).toBe(true)
  })

  it.each([
    ['chat:start', { cwd: '', text: 'hola' }],
    ['chat:start', { cwd: 'C:/p', text: '' }],
    ['chat:start', { cwd: 'C:/p', text: 'x', mode: 'dontAsk' }],
    ['chat:start', { cwd: 'C:/p', text: 'x', extra: 1 }],
    ['chat:send', { sessionId: 'no-es-uuid', text: 'hola' }],
    ['chat:send', { sessionId: SID, text: 'x'.repeat(100_001) }],
    ['chat:send', { sessionId: SID, text: 'hola', cwd: 'C:/otra' }],
    ['chat:permission', { sessionId: SID, requestId: 'abc', decision: 'allow' }],
    ['chat:permission', { sessionId: SID, requestId: UUID, decision: 'yolo' }],
    ['chat:permission', { sessionId: SID, requestId: UUID, decision: 'always', scope: 'user' }],
    ['chat:setMode', { sessionId: SID, mode: 'auto' }],
    ['chat:stopTask', { sessionId: SID, taskId: '../x' }],
    ['chat:interrupt', { sessionId: SID, extra: true }]
  ] as const)('%s rechaza %j', (channel, raw) => {
    expect(invokeContract[channel].input.safeParse(raw).success).toBe(false)
  })
})

describe('canales de uso', () => {
  it.each([
    ['usage:report', { period: '7d', scope: 'project', projectId: null }],
    ['usage:report', { period: 'año', scope: 'all', projectId: null }],
    ['usage:report', { period: '7d', scope: 'all', projectId: null, extra: 1 }],
    ['usage:probe', { force: 'sí' }],
    ['usage:sessionCost', '']
  ] as const)('%s con %j devuelve INVALID_ARGS', async (channel, raw) => {
    const fn = vi.fn()
    handle(channel, fn)
    const result = await listeners.get(channel)?.(trusted, raw)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } })
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('canales de búsqueda', () => {
  it.each([
    ['sessions:follow', { sessionId: 42 }],
    ['sessions:follow', { sessionId: 'x', extra: 1 }],
    ['sessions:follow', undefined]
  ] as const)('%s con %j devuelve INVALID_ARGS', async (channel, raw) => {
    const fn = vi.fn()
    handle(channel, fn)
    const result = await listeners.get(channel)?.(trusted, raw)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } })
    expect(fn).not.toHaveBeenCalled()
  })
})
