import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { IndexStatus, IndexUpdated } from '../../src/shared/projects'
import type { PassResult } from '../../src/main/services/indexer'
import {
  createIndexService,
  type IndexWorker,
  type WorkerRequest,
  type WorkerResponse
} from '../../src/main/services/index-service'

/** Worker simulado: guarda las órdenes y responde cuando el test lo dice. */
class FakeWorker extends EventEmitter {
  requests: WorkerRequest[] = []
  terminated = false
  postMessage(message: WorkerRequest): void {
    this.requests.push(message)
  }
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(0)
  }
  reply(message: WorkerResponse): void {
    this.emit('message', message)
  }
  finish(result: Partial<PassResult> = {}): void {
    const last = this.requests.at(-1)
    if (!last) throw new Error('sin órdenes')
    this.reply({
      type: 'done',
      id: last.id,
      result: { filesRead: 0, changedSessions: 0, removedSessions: 0, durationMs: 1, ...result }
    })
  }
}

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function status(running: boolean): IndexStatus {
  return {
    path: 'x',
    ok: true,
    schemaVersion: 1,
    files: 0,
    sessions: 0,
    usageEvents: 0,
    usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    hiddenSessions: 0,
    running
  }
}

function setup(): {
  workers: FakeWorker[]
  notes: IndexUpdated[]
  service: ReturnType<typeof createIndexService>
} {
  const workers: FakeWorker[] = []
  const notes: IndexUpdated[] = []
  const service = createIndexService({
    createWorker: () => {
      const w = new FakeWorker()
      workers.push(w)
      return w as unknown as IndexWorker
    },
    claudeDir: () => 'C:\\claude',
    status,
    notify: (p) => notes.push(p),
    log: quiet
  })
  return { workers, notes, service }
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('IndexService', () => {
  it('crea el worker con la primera petición y avisa al empezar y al terminar', async () => {
    const { workers, notes, service } = setup()
    expect(workers).toHaveLength(0)
    const done = service.refresh()
    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests).toEqual([{ type: 'pass', id: 1, claudeDir: 'C:\\claude' }])
    expect(service.running).toBe(true)
    expect(notes).toEqual([{ changed: false, status: status(true) }])

    workers[0]?.finish({ changedSessions: 2 })
    await expect(done).resolves.toMatchObject({ changedSessions: 2 })
    expect(service.running).toBe(false)
    expect(notes.at(-1)).toEqual({ changed: true, status: status(false) })
  })

  it('tres peticiones seguidas → dos pasadas; todas se resuelven', async () => {
    const { workers, service } = setup()
    const a = service.refresh()
    const b = service.refresh()
    const c = service.refresh()
    const w = workers[0] as FakeWorker
    expect(w.requests).toHaveLength(1)

    w.finish({ filesRead: 1 })
    await expect(a).resolves.toMatchObject({ filesRead: 1 })
    expect(w.requests).toHaveLength(2)
    w.finish({ filesRead: 0 })
    await expect(Promise.all([b, c])).resolves.toMatchObject([{ filesRead: 0 }, { filesRead: 0 }])
    expect(w.requests).toHaveLength(2)
    expect(workers).toHaveLength(1)
  })

  it('un rebuild pendiente gana a un pass', async () => {
    const { workers, service } = setup()
    void service.refresh()
    void service.refresh()
    void service.rebuild()
    void service.refresh()
    const w = workers[0] as FakeWorker
    w.finish()
    await flush()
    expect(w.requests.map((r) => r.type)).toEqual(['pass', 'rebuild'])
  })

  it('error del worker → la petición falla y la siguiente funciona', async () => {
    const { workers, service } = setup()
    const failed = service.refresh()
    const w = workers[0] as FakeWorker
    w.reply({ type: 'error', id: 1, message: 'disco lleno' })
    await expect(failed).rejects.toThrow('disco lleno')
    const next = service.refresh()
    w.finish()
    await expect(next).resolves.toBeDefined()
  })

  it('si el worker muere, la petición en curso falla y se recrea en la siguiente', async () => {
    const { workers, service } = setup()
    const first = service.refresh()
    workers[0]?.emit('exit', 1)
    await expect(first).rejects.toThrow(/terminó/)
    expect(service.running).toBe(false)
    expect(quiet.error).toHaveBeenCalled()

    const second = service.refresh()
    expect(workers).toHaveLength(2)
    workers[1]?.finish()
    await expect(second).resolves.toBeDefined()
  })

  it('reenvía al log lo que registra el worker e ignora respuestas de otra orden', async () => {
    const { workers, service } = setup()
    const done = service.refresh()
    const w = workers[0] as FakeWorker
    w.reply({ type: 'log', level: 'warn', scope: 'index', message: 'aviso' })
    expect(quiet.warn).toHaveBeenCalledWith('index', 'aviso')
    w.reply({
      type: 'done',
      id: 99,
      result: { filesRead: 9, changedSessions: 0, removedSessions: 0, durationMs: 1 }
    })
    expect(service.running).toBe(true)
    w.finish()
    await expect(done).resolves.toMatchObject({ filesRead: 0 })
  })

  it('dispose termina el worker y rechaza lo pendiente', async () => {
    const { workers, service } = setup()
    const a = service.refresh()
    const b = service.refresh()
    await service.dispose()
    await expect(a).rejects.toThrow(/cerrando/)
    await expect(b).rejects.toThrow(/cerrando/)
    expect(workers[0]?.terminated).toBe(true)
    await expect(service.refresh()).rejects.toThrow(/cerrando/)
  })
})

describe('progreso', () => {
  it('reenvía el progreso como mucho cada 500 ms y lo quita al terminar', async () => {
    vi.useFakeTimers()
    try {
      const { workers, notes, service } = setup()
      const done = service.refresh()
      const w = workers[0] as FakeWorker
      const id = w.requests[0]?.id as number
      w.reply({ type: 'progress', id, done: 0, total: 40 })
      w.reply({ type: 'progress', id, done: 10, total: 40 })
      expect(notes.at(-1)?.status.progress).toEqual({ done: 0, total: 40 })
      expect(service.status().progress).toEqual({ done: 10, total: 40 })
      vi.advanceTimersByTime(600)
      w.reply({ type: 'progress', id, done: 20, total: 40 })
      expect(notes.at(-1)?.status.progress).toEqual({ done: 20, total: 40 })
      w.finish()
      await done
      expect(notes.at(-1)?.status.progress).toBeUndefined()
      expect(service.status().progress).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
