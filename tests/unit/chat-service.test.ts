import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatService,
  ChatServiceError,
  IDLE_CLOSE_MS,
  type ChatServiceDeps,
  type ResumeTarget
} from '../../src/main/services/chat/chat-service'
import {
  checkCwd,
  resolveClaudeExecutable,
  baseOptions
} from '../../src/main/services/chat/claude-runtime'
import type { ChatEvent } from '../../src/shared/chat'
import { emitUntil, fakeFactory, flush, isResult, pushes, replay } from './chat-fake-query'

const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bitacora-chat-'))
  dirs.push(dir)
  return dir
}

function setup(targets: Record<string, ResumeTarget> = {}): {
  service: ChatService
  queries: ReturnType<typeof fakeFactory>['queries']
  log: ChatEvent[]
  root: string
  clock: { now: number }
  turnEnds: { n: number }
} {
  const root = tempDir()
  mkdirSync(join(root, 'proyecto'))
  mkdirSync(join(root, '.claude'))
  const { factory, queries } = fakeFactory()
  const log: ChatEvent[] = []
  const clock = { now: 1_000_000 }
  const turnEnds = { n: 0 }
  const deps: ChatServiceDeps = {
    query: factory,
    base: () => ({ includePartialMessages: true }),
    claudeDir: () => join(root, '.claude'),
    resumeTarget: (id) => targets[id] ?? null,
    emit: (e) => log.push(e),
    onTurnEnd: () => {
      turnEnds.n += 1
    },
    knownModels: () => ['haiku', 'sonnet', 'claude-haiku-5-5'],
    log: quiet,
    now: () => clock.now,
    closeGraceMs: 0
  }
  return { service: new ChatService(deps), queries, log, root, clock, turnEnds }
}

describe('ChatService', () => {
  it('start comprueba la carpeta', async () => {
    const { service, root, queries } = setup()
    await expect(
      service.start({ cwd: join(root, 'no-existe'), text: 'hola' })
    ).rejects.toMatchObject({
      code: 'INVALID_CWD'
    })
    await expect(
      service.start({ cwd: join(root, '.claude'), text: 'hola' })
    ).rejects.toBeInstanceOf(ChatServiceError)
    expect(queries).toHaveLength(0)
    const { chatId, uuid } = await service.start({
      cwd: join(root, 'proyecto'),
      text: 'hola',
      mode: 'plan'
    })
    await flush()
    expect(chatId).toMatch(/^[0-9a-f-]{36}$/)
    expect(queries[0]!.received.map((m) => m.uuid)).toEqual([uuid])
    expect(queries[0]!.options.permissionMode).toBe('plan')
    expect(service.active()).toEqual([
      { chatId, sessionId: null, status: 'starting', incognito: false }
    ])
  })

  it('al conocer el id, la sesión se encuentra por él; fin de turno avisa', async () => {
    const { service, root, queries, turnEnds } = setup()
    const [a] = pushes('pregunta')
    await service.start({ cwd: join(root, 'proyecto'), text: a!.text, uuid: a!.uuid })
    await flush()
    await emitUntil(queries[0]!, replay('pregunta'), isResult, () => {
      const id = '23a86f7b-e53a-4322-9146-2d28cfab6b81'
      const req = service.snapshot(id)!.permissions[0]!
      service.respond({ sessionId: id, requestId: req.requestId, decision: 'deny' })
    })
    await flush()
    const snap = service.snapshot('23a86f7b-e53a-4322-9146-2d28cfab6b81')
    expect(snap).toMatchObject({
      status: 'idle',
      sessionId: '23a86f7b-e53a-4322-9146-2d28cfab6b81'
    })
    expect(turnEnds.n).toBe(1)
  })

  it('send a una sesión no activa la reanuda en su carpeta y con su modelo', async () => {
    const root = tempDir()
    const cwd = join(root, 'p')
    mkdirSync(cwd)
    const { service, queries } = setup({
      origen: { sessionId: 'ultima', cwd, model: 'claude-haiku-5-5' },
      ultima: { sessionId: 'ultima', cwd, model: 'claude-haiku-5-5' }
    })
    const { chatId } = await service.send({ sessionId: 'origen', text: 'sigue' })
    await flush()
    expect(queries[0]!.options).toMatchObject({ resume: 'ultima', model: 'claude-haiku-5-5' })
    // Se llega por los dos ids, y un segundo mensaje no crea otro proceso.
    expect(service.get('origen')?.chatId).toBe(chatId)
    expect(service.get('ultima')?.chatId).toBe(chatId)
    await service.send({ sessionId: 'ultima', text: 'más' })
    expect(queries).toHaveLength(1)
  })

  it('un modelo guardado que ya no existe no se pasa', async () => {
    const root = tempDir()
    const { service, queries } = setup({ s: { sessionId: 's', cwd: root, model: 'claude-viejo' } })
    await service.send({ sessionId: 's', text: 'hola' })
    await flush()
    expect(queries[0]!.options.model).toBeUndefined()
    await expect(service.setModel('s', 'inventado')).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await service.setModel('s', 'sonnet')
    expect(queries[0]!.calls).toEqual(['setModel:sonnet'])
  })

  it('carpeta de la sesión desaparecida o sesión desconocida', async () => {
    const gone = join(tempDir(), 'borrada')
    const { service } = setup({ s: { sessionId: 's', cwd: gone } })
    await expect(service.send({ sessionId: 's', text: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CWD',
      message: 'La carpeta de esta sesión ya no existe.'
    })
    await expect(service.send({ sessionId: 'nadie', text: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    expect(() => service.require('nadie')).toThrow(ChatServiceError)
    expect(service.snapshot('nadie')).toBeNull()
  })

  it('inactividad: cierra la sesión en reposo pasados 10 min', async () => {
    const { service, root, queries, clock } = setup()
    const [a] = pushes('saltar')
    await service.start({ cwd: join(root, 'proyecto'), text: a!.text, uuid: a!.uuid })
    await flush()
    await emitUntil(queries[0]!, replay('saltar'), isResult)
    await flush()
    clock.now += IDLE_CLOSE_MS - 1
    service.sweepIdle()
    expect(service.size).toBe(1)
    clock.now += 2
    service.sweepIdle()
    expect(service.size).toBe(0)
    await flush()
    expect(queries[0]!.inputClosed).toBe(true)
  })

  it('trabajando no se cierra por inactividad; busy y closeAll', async () => {
    const { service, root, queries, clock } = setup()
    await service.start({ cwd: join(root, 'proyecto'), text: 'uno' })
    await service.start({ cwd: join(root, 'proyecto'), text: 'dos' })
    await flush()
    expect(service.busy()).toEqual({ working: 2, waiting: 0 })
    clock.now += IDLE_CLOSE_MS * 2
    service.sweepIdle()
    expect(service.size).toBe(2)
    await service.closeAll()
    expect(service.size).toBe(0)
    expect(queries.every((q) => q.inputClosed && q.closed)).toBe(true)
    expect(queries.every((q) => q.calls.includes('interrupt'))).toBe(true)
  })

  it('incógnito: sin guardar en disco, sin cierre por inactividad ni relanzamientos; cerrar la borra', async () => {
    const { service, root, queries, clock } = setup()
    const [a] = pushes('saltar')
    await service.start({
      cwd: join(root, 'proyecto'),
      text: a!.text,
      uuid: a!.uuid,
      incognito: true
    })
    await flush()
    expect(queries[0]!.options.persistSession).toBe(false)
    await emitUntil(queries[0]!, replay('saltar'), isResult)
    await flush()
    const [entry] = service.active()
    expect(entry).toMatchObject({ incognito: true, status: 'idle' })
    const id = entry!.sessionId!
    expect(service.snapshot(id)?.incognito).toBe(true)

    clock.now += IDLE_CLOSE_MS * 2
    service.sweepIdle()
    expect(service.size).toBe(1)

    await expect(service.setChrome(id, true)).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(service.setMode(id, 'bypassPermissions')).rejects.toMatchObject({
      code: 'INVALID_ARGS'
    })
    expect(service.snapshot(id)).toMatchObject({ mode: 'default', chrome: { enabled: false } })
    expect(queries[0]!.closed).toBe(false)

    await service.close(id)
    expect(service.snapshot(id)).toBeNull()
    await expect(service.send({ sessionId: id, text: 'sigue' })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    expect(queries).toHaveLength(1)
  })
})

describe('claude-runtime', () => {
  it('checkCwd: carpeta válida, inexistente, relativa, archivo y dentro de la de Claude Code', async () => {
    const root = tempDir()
    const claude = join(root, '.claude')
    mkdirSync(join(claude, 'projects'), { recursive: true })
    mkdirSync(join(root, 'p'))
    writeFileSync(join(root, 'a.txt'), 'x')
    expect((await checkCwd(join(root, 'p'), claude)).ok).toBe(true)
    for (const cwd of [join(root, 'no'), 'relativa', join(root, 'a.txt')])
      expect(await checkCwd(cwd, claude)).toEqual({ ok: false, reason: 'missing' })
    expect(await checkCwd(join(claude, 'projects'), claude)).toEqual({
      ok: false,
      reason: 'claude-dir'
    })
    mkdirSync(join(root, '.claude-otra'))
    expect((await checkCwd(join(root, '.claude-otra'), claude)).ok).toBe(true)
  })

  it('resolveClaudeExecutable cambia app.asar por app.asar.unpacked', () => {
    const resolve = (): string => 'C:\\app\\resources\\app.asar\\node_modules\\x\\claude.exe'
    expect(resolveClaudeExecutable(resolve, 'win32', 'x64')).toBe(
      'C:\\app\\resources\\app.asar.unpacked\\node_modules\\x\\claude.exe'
    )
    expect(
      resolveClaudeExecutable(() => {
        throw new Error('no')
      })
    ).toBeUndefined()
  })

  it('baseOptions: todos los ajustes, sin restricciones; CLAUDE_CONFIG_DIR si es propia', () => {
    const plain = baseOptions({
      claudeDir: 'C:\\c',
      customClaudeDir: false,
      claudePath: 'C:\\claude.exe'
    })
    expect(plain).toEqual({
      pathToClaudeCodeExecutable: 'C:\\claude.exe',
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local']
    })
    expect(plain).not.toHaveProperty('tools')
    expect(plain).not.toHaveProperty('strictMcpConfig')
    const custom = baseOptions({ claudeDir: 'D:\\otra', customClaudeDir: true, env: { A: '1' } })
    expect(custom.env).toEqual({ A: '1', CLAUDE_CONFIG_DIR: 'D:\\otra' })
  })
})
