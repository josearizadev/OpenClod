import { describe, expect, it } from 'vitest'
import { claudeLine, detectShells, shellArgs, shellKindOf } from '../../src/main/services/shell'

describe('detectShells', () => {
  it('Windows: PowerShell 7 primero si está, luego Windows PowerShell, cmd y Git Bash', async () => {
    const existing = new Set([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe'
    ])
    const shells = await detectShells({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      which: async (c) => (c === 'pwsh.exe' ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : null),
      exists: (p) => existing.has(p)
    })
    expect(shells.map((s) => [s.id, s.kind])).toEqual([
      ['pwsh', 'powershell'],
      ['powershell', 'powershell'],
      ['cmd', 'cmd']
    ])
  })

  it('POSIX: $SHELL primero y sin duplicados', async () => {
    const shells = await detectShells({
      platform: 'linux',
      env: { SHELL: '/bin/zsh' },
      which: async () => null,
      exists: (p) => p === '/bin/zsh' || p === '/bin/bash'
    })
    expect(shells.map((s) => s.path)).toEqual(['/bin/zsh', '/bin/bash'])
  })
})

describe('argumentos y orden de claude', () => {
  it('argumentos por tipo de shell', () => {
    expect(shellArgs({ kind: 'powershell', path: 'pwsh.exe' })).toEqual(['-NoLogo'])
    expect(shellArgs({ kind: 'cmd', path: 'cmd.exe' })).toEqual([])
    expect(shellArgs({ kind: 'posix', path: '/bin/zsh' })).toEqual(['-l'])
    expect(shellKindOf('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix')
  })

  it('claude del PATH o el de la app, con comillas por shell', () => {
    const id = '07319c10-f4d8-43f5-b876-ec4c89ae65d4'
    expect(claudeLine('powershell', { onPath: true, bundled: null }, id)).toBe(
      `claude --resume ${id}`
    )
    expect(claudeLine('posix', { onPath: true, bundled: null })).toBe('claude')
    const bundled = "C:\\Program Files\\Bitácora\\it's\\claude.exe"
    expect(claudeLine('powershell', { onPath: false, bundled }, id)).toBe(
      `& 'C:\\Program Files\\Bitácora\\it''s\\claude.exe' --resume ${id}`
    )
    expect(claudeLine('cmd', { onPath: false, bundled })).toBe(`"${bundled}"`)
    expect(claudeLine('posix', { onPath: false, bundled: "/opt/a b/it's/claude" })).toBe(
      `'/opt/a b/it'\\''s/claude'`
    )
    expect(claudeLine('posix', { onPath: false, bundled: null })).toBeNull()
  })

  it('rechaza ids de sesión que podrían inyectar órdenes', () => {
    const claude = { onPath: true, bundled: null }
    expect(claudeLine('powershell', claude, 'x; rm -rf /')).toBeNull()
    expect(claudeLine('posix', claude, '$(whoami)')).toBeNull()
    expect(claudeLine('cmd', claude, 'a&b')).toBeNull()
  })
})
