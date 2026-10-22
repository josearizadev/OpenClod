import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../src/shared/update'
import { createAppUpdater, type UpdaterLike } from '../../src/main/services/updater'

const log = { file: null, info: vi.fn(), warn: vi.fn(), error: vi.fn() }

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async () => {
    this.emit('checking-for-update')
    return null
  })
  quitAndInstall = vi.fn()
}

function setup(): { fake: FakeUpdater; emitted: UpdateStatus[] } & ReturnType<
  typeof createAppUpdater
> {
  const fake = new FakeUpdater()
  const emitted: UpdateStatus[] = []
  const updater = createAppUpdater({
    updater: fake,
    emit: (status) => emitted.push(status),
    log,
    now: () => new Date('2026-10-22T10:00:00Z'),
    firstCheckMs: 1000,
    intervalMs: 60_000
  })
  return Object.assign(updater, { fake, emitted })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createAppUpdater', () => {
  it('en desarrollo está desactivado y no hace nada', async () => {
    const updater = createAppUpdater({ updater: null, emit: vi.fn(), log })
    expect(updater.status()).toEqual({ state: 'disabled' })
    await updater.check()
    expect(updater.install()).toBe(false)
  })

  it('descarga sola e instala al salir', () => {
    const { fake } = setup()
    expect(fake.autoDownload).toBe(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
  })

  it('busca, descarga con progreso y queda lista', async () => {
    const u = setup()
    await u.check()
    expect(u.status()).toEqual({ state: 'checking' })
    u.fake.emit('update-available', { version: '1.4.0' })
    u.fake.emit('download-progress', { percent: 41.6 })
    u.fake.emit('download-progress', { percent: 41.9 })
    u.fake.emit('update-downloaded', { version: '1.4.0' })
    expect(u.emitted).toEqual([
      { state: 'checking' },
      { state: 'downloading', version: '1.4.0', percent: 0 },
      { state: 'downloading', version: '1.4.0', percent: 42 },
      { state: 'ready', version: '1.4.0' }
    ])
  })

  it('sin versión nueva guarda cuándo se comprobó', async () => {
    const u = setup()
    await u.check()
    u.fake.emit('update-not-available')
    expect(u.status()).toEqual({ state: 'latest', checkedAt: '2026-10-22T10:00:00.000Z' })
  })

  it('no vuelve a buscar con una descarga en curso o ya lista', async () => {
    const u = setup()
    u.fake.emit('update-available', { version: '1.4.0' })
    await u.check()
    u.fake.emit('update-downloaded', { version: '1.4.0' })
    await u.check()
    expect(u.fake.checkForUpdates).not.toHaveBeenCalled()
  })

  it('error de red: mensaje corto; con una versión lista, el error no la pierde', async () => {
    const u = setup()
    u.fake.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'))
    await u.check()
    expect(u.status()).toEqual({
      state: 'error',
      message: 'No se pudo conectar con el servidor de actualizaciones.'
    })
    u.fake.emit('update-downloaded', { version: '1.4.0' })
    u.fake.emit('error', new Error('HttpError: 404'))
    expect(u.status()).toEqual({ state: 'ready', version: '1.4.0' })
  })

  it('instalar solo con una versión lista: en silencio y vuelve a abrir la app', () => {
    const u = setup()
    expect(u.install()).toBe(false)
    u.fake.emit('update-downloaded', { version: '1.4.0' })
    expect(u.install()).toBe(true)
    expect(u.fake.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('start: primera búsqueda al rato y después periódica; dispose las para', async () => {
    vi.useFakeTimers()
    const u = setup()
    u.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(u.fake.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(u.fake.checkForUpdates).toHaveBeenCalledTimes(1)
    u.fake.emit('update-not-available')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(u.fake.checkForUpdates).toHaveBeenCalledTimes(2)
    u.dispose()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(u.fake.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})
