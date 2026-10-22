import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalOpenInput } from '../../src/shared/terminal'
import {
  createTerminalService,
  MAX_TERMINALS,
  trimBuffer,
  type PtyLike,
  type SpawnPty,
  type TerminalServiceDeps
} from '../../src/main/services/terminal'

class FakePty implements PtyLike {
  static last: FakePty | null = null
  readonly pid = 1234
  written: string[] = []
  size: [number, number] = [0, 0]
  killed = false
  private dataListeners: ((d: string) => void)[] = []
  private exitListeners: ((e: { exitCode: number }) => void)[] = []
  constructor(
    readonly file: string,
    readonly args: string[],
    readonly options: Parameters<SpawnPty>[2]
  ) {
    FakePty.last = this
  }
  onData(l: (d: string) => void): { dispose(): void } {
    this.dataListeners.push(l)
    return { dispose: () => {} }
  }
  onExit(l: (e: { exitCode: number }) => void): { dispose(): void } {
    this.exitListeners.push(l)
    return { dispose: () => {} }
  }
  write(d: string): void {
    this.written.push(d)
  }
  resize(c: number, r: number): void {
    this.size = [c, r]
  }
  kill(): void {
    this.killed = true
  }
  emit(d: string): void {
    for (const l of this.dataListeners) l(d)
  }
  exit(code: number): void {
    for (const l of this.exitListeners) l({ exitCode: code })
  }
}

const spawn: SpawnPty = (file, args, options) => new FakePty(file, args, options)
const input = (kind: TerminalOpenInput['kind'] = 'shell'): TerminalOpenInput => ({
  kind,
  ...(kind === 'resume' ? { target: { sessionId: 's1' } } : {}),
  cols: 80,
  rows: 24
})

function setup(overrides: Partial<TerminalServiceDeps> = {}): {
  service: ReturnType<typeof createTerminalService>
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  const service = createTerminalService({
    spawn,
    shell: async () => ({
      id: 'pwsh',
      label: 'PowerShell 7',
      path: 'pwsh.exe',
      kind: 'powershell'
    }),
    env: async () => ({ PATH: 'x', CLAUDE_CONFIG_DIR: 'D:\\claude' }),
    claude: async () => ({ onPath: true, bundled: null }),
    resolve: async (i) =>
      i.kind === 'resume'
        ? { cwd: 'Z:\\repo', label: 'Arreglar el login', sessionId: 's2' }
        : { cwd: 'Z:\\repo', label: 'repo' },
    send,
    ...overrides
  })
  return { service, send }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TerminalService', () => {
  it('abre el shell en la carpeta con su entorno y título', async () => {
    const { service } = setup()
    const info = await service.open(7, input())
    const pty = FakePty.last!
    expect(pty.file).toBe('pwsh.exe')
    expect(pty.args).toEqual(['-NoLogo'])
    expect(pty.options).toMatchObject({ cwd: 'Z:\\repo', cols: 80, rows: 24, useConpty: true })
    expect(pty.options.env['CLAUDE_CONFIG_DIR']).toBe('D:\\claude')
    expect(info).toMatchObject({ kind: 'shell', title: 'PowerShell 7 · repo', status: 'running' })
  })

  it('resume: escribe `claude --resume` de la última sesión tras la primera salida', async () => {
    const { service } = setup()
    const info = await service.open(7, input('resume'))
    const pty = FakePty.last!
    expect(info.title).toBe('claude · Arreglar el login')
    expect(pty.written).toEqual([])
    pty.emit('PS Z:\\repo> ')
    vi.advanceTimersByTime(60)
    expect(pty.written).toEqual(['claude --resume s2\r'])
    vi.advanceTimersByTime(1000)
    expect(pty.written).toHaveLength(1)
  })

  it('si el shell no escribe nada, la orden sale a los 500 ms', async () => {
    const { service } = setup()
    await service.open(7, input('claude'))
    vi.advanceTimersByTime(499)
    expect(FakePty.last!.written).toEqual([])
    vi.advanceTimersByTime(1)
    expect(FakePty.last!.written).toEqual(['claude\r'])
  })

  it('sin claude avisa en la terminal y no escribe la orden', async () => {
    const { service } = setup({ claude: async () => ({ onPath: false, bundled: null }) })
    const info = await service.open(7, input('claude'))
    vi.advanceTimersByTime(600)
    expect(FakePty.last!.written).toEqual([])
    expect(service.attach(7, info.id).buffer).toContain('No se encontró Claude Code')
  })

  it('agrupa la salida en lotes de 8 ms y la guarda para attach', async () => {
    const { service, send } = setup()
    const info = await service.open(7, input())
    const pty = FakePty.last!
    pty.emit('a')
    pty.emit('b')
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(send).toHaveBeenCalledWith(7, 'terminal:data', { id: info.id, data: 'ab' })
    pty.emit('c')
    // attach envía lo pendiente al dueño anterior y cambia de dueño.
    expect(service.attach(9, info.id)).toEqual({ info, buffer: 'abc' })
    pty.emit('d')
    vi.advanceTimersByTime(8)
    expect(send).toHaveBeenLastCalledWith(9, 'terminal:data', { id: info.id, data: 'd' })
  })

  it('al salir: lo pendiente, exit y estado terminado; reiniciar reutiliza el id', async () => {
    const { service, send } = setup()
    const info = await service.open(7, input())
    const first = FakePty.last!
    first.emit('adiós')
    first.exit(3)
    expect(send).toHaveBeenNthCalledWith(1, 7, 'terminal:data', { id: info.id, data: 'adiós' })
    expect(send).toHaveBeenNthCalledWith(2, 7, 'terminal:exit', { id: info.id, exitCode: 3 })
    expect(service.list()[0]).toMatchObject({ status: 'exited', exitCode: 3 })
    expect(service.running()).toBe(0)
    service.write(info.id, 'x')
    expect(first.written).toEqual([])

    const again = await service.restart(info.id)
    expect(again.id).toBe(info.id)
    expect(again.status).toBe('running')
    expect(FakePty.last).not.toBe(first)
    // Las salidas del proceso anterior se ignoran.
    first.emit('viejo')
    expect(service.attach(7, info.id).buffer).toBe('')
  })

  it('resize, close, closeOwner, disposeAll y máximo de terminales', async () => {
    const { service } = setup()
    const a = await service.open(1, input())
    const pa = FakePty.last!
    service.resize(a.id, 120, 40)
    expect(pa.size).toEqual([120, 40])
    await service.open(2, input())
    const pb = FakePty.last!
    service.closeOwner(1)
    expect(pa.killed).toBe(true)
    expect(service.list().map((t) => t.id)).not.toContain(a.id)
    for (let i = 1; i < MAX_TERMINALS; i++) await service.open(2, input())
    await expect(service.open(2, input())).rejects.toThrow(/Máximo de 8/)
    service.disposeAll()
    expect(pb.killed).toBe(true)
    expect(service.list()).toEqual([])
    expect(() => service.write(a.id, 'x')).toThrow(/ya no existe/)
  })
})

describe('trimBuffer', () => {
  it('quita trozos enteros y recorta el último por un salto de línea', () => {
    const chunks = ['aaaa', 'bbbb', 'cc\ndd']
    expect(trimBuffer(chunks, 13, 6)).toBe(5)
    expect(chunks).toEqual(['cc\ndd'])
    const single = ['línea1\nlínea2\nfin']
    const size = trimBuffer(single, single[0]!.length, 8)
    expect(single).toEqual(['fin'])
    expect(size).toBe(3)
  })
})
