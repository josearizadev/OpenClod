import { describe, expect, it } from 'vitest'
import { invokeContract } from '../../src/shared/ipc-contract'

const ok = (channel: keyof typeof invokeContract, raw: unknown): boolean =>
  invokeContract[channel].input.safeParse(raw).success

describe('contrato de archivos y Git', () => {
  it('destino: sesión o proyecto, nunca una carpeta', () => {
    expect(ok('files:read', { target: { sessionId: 's1' }, path: 'src/a.ts' })).toBe(true)
    expect(
      ok('files:read', {
        target: { projectId: '00000000-0000-4000-8000-000000000000' },
        path: 'a'
      })
    ).toBe(true)
    expect(ok('files:read', { target: { root: 'C:\\' }, path: 'a' })).toBe(false)
    expect(ok('files:read', { target: { sessionId: 's1', root: 'C:\\' }, path: 'a' })).toBe(false)
    expect(ok('files:read', { target: { projectId: 'no-uuid' }, path: 'a' })).toBe(false)
    expect(ok('files:read', { target: { sessionId: 's1' }, path: '' })).toBe(false)
    expect(ok('files:open', { target: { sessionId: 's1' }, path: 'a', how: 'run' })).toBe(false)
  })

  it('CLAUDE.md: tamaño y hash', () => {
    const projectId = '00000000-0000-4000-8000-000000000000'
    expect(ok('claudeMd:write', { projectId, text: 'x', expectedHash: null })).toBe(true)
    expect(ok('claudeMd:write', { projectId, text: 'x', expectedHash: 'abc' })).toBe(false)
    expect(
      ok('claudeMd:write', { projectId, text: 'x'.repeat(1024 * 1024 + 1), expectedHash: null })
    ).toBe(false)
  })

  it('exportar y elegir carpeta', () => {
    expect(ok('sessions:export', { sessionId: 's', tools: true })).toBe(true)
    expect(ok('sessions:export', { sessionId: 's', tools: true, path: 'C:\\x.md' })).toBe(false)
    expect(ok('system:pickFolder', undefined)).toBe(true)
    expect(ok('system:pickFolder', { purpose: 'claudeDir' })).toBe(true)
    expect(ok('system:pickFolder', { purpose: 'otra' })).toBe(false)
  })
})
