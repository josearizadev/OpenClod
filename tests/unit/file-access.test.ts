import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileAccessError,
  isSecretName,
  isUnsafeToOpen,
  resolveInside,
  resolveRoot,
  type RootDeps
} from '../../src/main/services/file-access'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(): { base: string; project: string; claude: string; outside: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bitacora-files-')))
  dirs.push(base)
  const project = join(base, 'proyecto')
  const claude = join(base, '.claude')
  const outside = join(base, 'fuera')
  for (const d of [project, join(project, 'src'), claude, outside]) mkdirSync(d)
  writeFileSync(join(project, 'src', 'a.ts'), 'export {}\n')
  writeFileSync(join(outside, 'secreto.txt'), 'x')
  return { base, project, claude, outside }
}

function deps(project: string, claude: string): RootDeps {
  return {
    sessionCwd: (id) => (id === 's1' ? project : id === 'claude' ? claude : null),
    projectPath: (id) => (id === '00000000-0000-4000-8000-000000000000' ? project : null),
    claudeDir: () => claude
  }
}

describe('resolveRoot', () => {
  it('resuelve sesión y proyecto; rechaza lo desconocido y la carpeta de Claude Code', async () => {
    const { project, claude } = setup()
    const d = deps(project, claude)
    expect(await resolveRoot({ sessionId: 's1' }, d)).toBe(project)
    expect(await resolveRoot({ projectId: '00000000-0000-4000-8000-000000000000' }, d)).toBe(
      project
    )
    await expect(resolveRoot({ sessionId: 'otra' }, d)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    await expect(resolveRoot({ sessionId: 'claude' }, d)).rejects.toBeInstanceOf(FileAccessError)
  })
})

describe('resolveInside', () => {
  it('acepta relativas y absolutas dentro; muestra la ruta relativa', async () => {
    const { project, claude } = setup()
    expect(await resolveInside('src/a.ts', [project], claude)).toEqual({
      ok: true,
      abs: join(project, 'src', 'a.ts'),
      display: 'src/a.ts',
      exists: true
    })
    expect(await resolveInside(join(project, 'src', 'nuevo.ts'), [project], claude)).toEqual({
      ok: true,
      abs: join(project, 'src', 'nuevo.ts'),
      display: 'src/nuevo.ts',
      exists: false
    })
  })

  it('rechaza `..`, absolutas fuera y la carpeta de Claude Code', async () => {
    const { project, claude, outside } = setup()
    expect((await resolveInside('../fuera/secreto.txt', [project], claude)).ok).toBe(false)
    expect((await resolveInside(join(outside, 'secreto.txt'), [project], claude)).ok).toBe(false)
    // Aunque la raíz contenga la carpeta de Claude Code (proyecto = carpeta personal).
    const home = join(project, '..')
    expect((await resolveInside(join(claude, 'x.json'), [home], claude)).ok).toBe(false)
  })

  it('rechaza un enlace simbólico que apunta fuera', async (ctx) => {
    const { project, claude, outside } = setup()
    try {
      symlinkSync(outside, join(project, 'enlace'), 'junction')
    } catch {
      ctx.skip()
    }
    expect((await resolveInside('enlace/secreto.txt', [project], claude)).ok).toBe(false)
  })
})

describe('isSecretName / isUnsafeToOpen', () => {
  it('detecta archivos de secretos y deja los ejemplos', () => {
    for (const name of [
      '.env',
      '.env.local',
      'config/.env.production',
      '.credentials.json',
      '.claude.json',
      'id_ed25519',
      'cert.PEM',
      'clave.key',
      '.npmrc'
    ])
      expect(isSecretName(name), name).toBe(true)
    for (const name of ['.env.example', '.env.sample', 'id_ed25519.pub', 'README.md', 'env.ts'])
      expect(isSecretName(name), name).toBe(false)
  })

  it('no abre ejecutables (y .js en Windows)', () => {
    expect(isUnsafeToOpen('setup.EXE', 'linux')).toBe(true)
    expect(isUnsafeToOpen('run.ps1', 'win32')).toBe(true)
    expect(isUnsafeToOpen('acceso.lnk', 'win32')).toBe(true)
    expect(isUnsafeToOpen('app.js', 'win32')).toBe(true)
    expect(isUnsafeToOpen('app.js', 'darwin')).toBe(false)
    expect(isUnsafeToOpen('app.ts', 'win32')).toBe(false)
    expect(isUnsafeToOpen('notas.md', 'win32')).toBe(false)
  })
})
