import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProjectSettingsError,
  readProjectSettings,
  writeProjectSettings
} from '../../src/main/services/project-settings'
import {
  effective,
  gitRuleState,
  isValidRule,
  withGitRule,
  type ProjectSettingsPatch
} from '../../src/shared/project-settings'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(): { root: string; claude: string; local: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bitacora-ps-')))
  dirs.push(base)
  const root = join(base, 'proyecto')
  const claude = join(base, 'claude-data')
  mkdirSync(join(root, '.claude'), { recursive: true })
  mkdirSync(claude)
  return { root, claude, local: join(root, '.claude', 'settings.local.json') }
}

const EMPTY: ProjectSettingsPatch = { allow: [], ask: [], deny: [] }

describe('ajustes del proyecto: lectura', () => {
  it('sin archivos: capas vacías y hash null', async () => {
    const { root, claude } = setup()
    const s = await readProjectSettings(root, claude)
    expect(s.local).toMatchObject({ exists: false, hash: null, allow: [], defaultMode: null })
    expect(s.shared.exists).toBe(false)
    expect(s.user.exists).toBe(false)
  })

  it('solo lee las claves de la lista blanca, de las tres capas', async () => {
    const { root, claude, local } = setup()
    writeFileSync(
      local,
      JSON.stringify({
        env: { SECRET_API_KEY: 'x' },
        permissions: { allow: ['Bash', 3], defaultMode: 'acceptEdits' },
        attribution: { commit: '' }
      })
    )
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { deny: ['WebFetch'] } })
    )
    writeFileSync(
      join(claude, 'settings.json'),
      JSON.stringify({ includeCoAuthoredBy: true, permissions: { ask: ['Read'] } })
    )
    const s = await readProjectSettings(root, claude, true)
    expect(JSON.stringify(s)).not.toContain('SECRET')
    expect(s.local).toMatchObject({ allow: ['Bash'], defaultMode: 'acceptEdits', coAuthor: false })
    expect(s.shared.deny).toEqual(['WebFetch'])
    expect(s.user).toMatchObject({ ask: ['Read'], coAuthor: true })
    expect(s.chrome).toBe(true)
    expect(effective(s, (l) => l.coAuthor)).toBe(false)
    expect(effective(s, (l) => l.defaultMode)).toBe('acceptEdits')
  })

  it('JSON no válido: la capa sale como no válida, sin lanzar', async () => {
    const { root, claude, local } = setup()
    writeFileSync(local, '{ roto')
    const s = await readProjectSettings(root, claude)
    expect(s.local).toMatchObject({ exists: true, invalid: true, allow: [] })
  })
})

describe('ajustes del proyecto: escritura', () => {
  it('crea el archivo y conserva las claves que no gestiona', async () => {
    const { root, claude, local } = setup()
    const created = await writeProjectSettings(
      root,
      claude,
      { ...EMPTY, allow: ['Bash', 'Bash'], defaultMode: 'acceptEdits', coAuthor: false },
      null
    )
    expect(created.ok).toBe(true)
    expect(JSON.parse(readFileSync(local, 'utf8'))).toEqual({
      permissions: { allow: ['Bash'], defaultMode: 'acceptEdits' },
      attribution: { commit: '', pr: '' }
    })

    writeFileSync(
      local,
      JSON.stringify({
        model: 'opus',
        permissions: { allow: ['Bash'], additionalDirectories: ['../x'] },
        attribution: { commit: '', pr: '', sessionUrl: false },
        includeCoAuthoredBy: false
      })
    )
    const read = await readProjectSettings(root, claude)
    const result = await writeProjectSettings(
      root,
      claude,
      { allow: [], ask: ['Bash(git push *)'], deny: [], defaultMode: null, coAuthor: true },
      read.local.hash
    )
    expect(result.ok).toBe(true)
    expect(JSON.parse(readFileSync(local, 'utf8'))).toEqual({
      model: 'opus',
      permissions: { ask: ['Bash(git push *)'], additionalDirectories: ['../x'] },
      attribution: { sessionUrl: false }
    })
  })

  it('no escribe si el archivo cambió desde que se leyó', async () => {
    const { root, claude, local } = setup()
    const read = await readProjectSettings(root, claude)
    writeFileSync(local, JSON.stringify({ permissions: { allow: ['Read'] } }))
    const result = await writeProjectSettings(root, claude, EMPTY, read.local.hash)
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(result.settings.local.allow).toEqual(['Read'])
    expect(JSON.parse(readFileSync(local, 'utf8')).permissions.allow).toEqual(['Read'])
  })

  it('no toca un archivo que no es JSON válido', async () => {
    const { root, claude, local } = setup()
    writeFileSync(local, '{ roto')
    const read = await readProjectSettings(root, claude)
    await expect(writeProjectSettings(root, claude, EMPTY, read.local.hash)).rejects.toThrow(
      ProjectSettingsError
    )
    expect(readFileSync(local, 'utf8')).toBe('{ roto')
  })

  it('nunca escribe dentro de la carpeta de Claude Code', async () => {
    const { claude } = setup()
    // Un proyecto en la carpeta personal: su `.claude` es la de Claude Code.
    const home = join(claude, '..')
    await expect(writeProjectSettings(home, join(home, '.claude'), EMPTY, null)).rejects.toThrow(
      ProjectSettingsError
    )
  })
})

describe('reglas de Git y validación', () => {
  it('estado y cambio de las reglas de commit y push', () => {
    const base = { allow: ['Bash'], ask: [], deny: [] }
    expect(gitRuleState(base, 'push')).toBe('inherit')
    const denied = withGitRule(base, 'push', 'deny')
    expect(denied.deny).toEqual(['Bash(git push *)', 'PowerShell(git push *)'])
    expect(gitRuleState(denied, 'push')).toBe('deny')
    expect(gitRuleState(denied, 'commit')).toBe('inherit')
    const allowed = withGitRule(denied, 'push', 'allow')
    expect(allowed).toEqual({
      allow: ['Bash', 'Bash(git push *)', 'PowerShell(git push *)'],
      ask: [],
      deny: []
    })
    expect(withGitRule(allowed, 'push', 'inherit').allow).toEqual(['Bash'])
  })

  it('valida el formato de las reglas', () => {
    expect(isValidRule('Bash')).toBe(true)
    expect(isValidRule('Bash(npm run test *)')).toBe(true)
    expect(isValidRule('mcp__claude-in-chrome__navigate')).toBe(true)
    expect(isValidRule('Bash(')).toBe(false)
    expect(isValidRule('no vale')).toBe(false)
    expect(isValidRule('')).toBe(false)
  })
})
