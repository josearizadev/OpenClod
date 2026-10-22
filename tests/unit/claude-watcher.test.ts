import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeWatcher, isIgnored } from '../../src/main/services/claude-watcher'

class FakeFsWatcher extends EventEmitter {
  closed = false
  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function setup(): {
  watchers: FakeFsWatcher[]
  batches: string[][]
  w: ReturnType<typeof createClaudeWatcher>
} {
  const watchers: FakeFsWatcher[] = []
  const batches: string[][] = []
  const w = createClaudeWatcher({
    projectsDir: () => '/claude/projects',
    onBatch: (paths) => batches.push(paths),
    createWatcher: () => {
      const fake = new FakeFsWatcher()
      watchers.push(fake)
      return fake
    },
    exists: () => true,
    log: quiet
  })
  return { watchers, batches, w }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('isIgnored', () => {
  it('filtra por tipo de archivo y carpetas excluidas', () => {
    expect(isIgnored('/p/C--x/abc.jsonl')).toBe(false)
    expect(isIgnored('/p/C--x/abc/subagents/agent-1.meta.json')).toBe(false)
    expect(isIgnored('/p/C--x/abc/tool-results/out.txt')).toBe(true)
    expect(isIgnored('/p/C--x/abc/tool-results')).toBe(true)
    expect(isIgnored('/p/C--x/memory/notes.jsonl')).toBe(true)
    expect(isIgnored('/p/C--x/abc/file.txt')).toBe(true)
    expect(isIgnored('/p/C--x/abc')).toBe(false)
  })
})

describe('ClaudeWatcher', () => {
  it('agrupa en una ventana fija que no se reinicia', () => {
    vi.useFakeTimers()
    const { watchers, batches, w } = setup()
    w.start()
    const fake = watchers[0] as FakeFsWatcher
    fake.emit('ready')
    fake.emit('all', 'change', '/claude/projects/a/1.jsonl')
    vi.advanceTimersByTime(200)
    fake.emit('all', 'change', '/claude/projects/a/1.jsonl')
    fake.emit('all', 'add', '/claude/projects/a/2.jsonl')
    vi.advanceTimersByTime(100)
    expect(batches).toEqual([['/claude/projects/a/1.jsonl', '/claude/projects/a/2.jsonl']])
    // Lo que llega después abre otra ventana.
    fake.emit('all', 'unlink', '/claude/projects/a/2.jsonl')
    vi.advanceTimersByTime(299)
    expect(batches).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(batches[1]).toEqual(['/claude/projects/a/2.jsonl'])
    expect(w.status().state).toBe('watching')
    expect(w.status().lastEventAt).toBeDefined()
  })

  it('lo que llega durante onBatch va a la ventana siguiente', () => {
    vi.useFakeTimers()
    const watchers: FakeFsWatcher[] = []
    const batches: string[][] = []
    const w = createClaudeWatcher({
      projectsDir: () => '/c/projects',
      onBatch: (paths) => {
        batches.push(paths)
        if (batches.length === 1) watchers[0]?.emit('all', 'change', '/c/projects/b.jsonl')
      },
      createWatcher: () => {
        const fake = new FakeFsWatcher()
        watchers.push(fake)
        return fake
      },
      exists: () => true,
      log: quiet
    })
    w.start()
    watchers[0]?.emit('all', 'change', '/c/projects/a.jsonl')
    vi.advanceTimersByTime(300)
    expect(batches).toEqual([['/c/projects/a.jsonl']])
    vi.advanceTimersByTime(300)
    expect(batches).toEqual([['/c/projects/a.jsonl'], ['/c/projects/b.jsonl']])
  })

  it('un error o la falta de ready pasan a sondeo', () => {
    vi.useFakeTimers()
    const { watchers, w } = setup()
    w.start()
    watchers[0]?.emit('error', new Error('EMFILE'))
    expect(w.status()).toMatchObject({ state: 'polling', reason: 'EMFILE' })
    expect(watchers[0]?.closed).toBe(true)

    w.restart()
    expect(w.status().state).toBe('watching')
    vi.advanceTimersByTime(10_000)
    expect(w.status().state).toBe('polling')
  })

  it('sin projects/ queda apagada; restart abre una nueva', () => {
    let present = false
    const watchers: FakeFsWatcher[] = []
    const w = createClaudeWatcher({
      projectsDir: () => '/nada/projects',
      onBatch: () => {},
      createWatcher: () => {
        const fake = new FakeFsWatcher()
        watchers.push(fake)
        return fake
      },
      exists: () => present,
      log: quiet
    })
    w.start()
    expect(w.status().state).toBe('off')
    present = true
    w.restart()
    expect(w.status().state).toBe('watching')
    w.restart()
    expect(watchers[0]?.closed).toBe(true)
    expect(watchers).toHaveLength(2)
    w.dispose()
    expect(watchers[1]?.closed).toBe(true)
  })

  it('con chokidar real: ve añadir líneas, subagentes y borrados sin bloquear', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bitacora-watch-'))
    const projects = join(root, 'projects')
    const folder = join(projects, 'C--demo')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, 'sess.jsonl')
    writeFileSync(file, '{"type":"user"}\n')
    const batches: string[][] = []
    const w = createClaudeWatcher({
      projectsDir: () => projects,
      onBatch: (paths) => batches.push(paths),
      log: quiet
    })
    w.start()
    try {
      await new Promise((r) => setTimeout(r, 500))
      appendFileSync(file, '{"type":"assistant"}\n')
      mkdirSync(join(folder, 'sess', 'subagents'), { recursive: true })
      writeFileSync(join(folder, 'sess', 'subagents', 'agent-1.jsonl'), '{}\n')
      writeFileSync(join(folder, 'sess', 'subagents', 'notas.txt'), 'x')
      await new Promise((r) => setTimeout(r, 900))
      rmSync(file)
      await new Promise((r) => setTimeout(r, 900))
      const all = batches.flat()
      expect(all.some((p) => p.endsWith('sess.jsonl'))).toBe(true)
      expect(all.some((p) => p.endsWith('agent-1.jsonl'))).toBe(true)
      expect(all.some((p) => p.endsWith('notas.txt'))).toBe(false)
      expect(w.status().state).toBe('watching')
    } finally {
      w.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)
})
