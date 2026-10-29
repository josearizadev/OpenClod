import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileMentions, rankMentions, withDirs } from '../../src/main/services/file-mentions'
import type { GitRun } from '../../src/main/services/git'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const noGit: GitRun = async () => ({ ok: false, missing: false, message: 'not a git repository' })
const gitWith =
  (files: string[]): GitRun =>
  async () => ({ ok: true, stdout: Buffer.from(files.join('\0') + '\0') })

describe('withDirs', () => {
  it('añade cada carpeta una vez, antes que los archivos', () => {
    expect(withDirs(['src/a.ts', 'src/lib/b.ts', 'README.md'])).toEqual([
      { path: 'src', dir: true },
      { path: 'src/lib', dir: true },
      { path: 'src/a.ts', dir: false },
      { path: 'src/lib/b.ts', dir: false },
      { path: 'README.md', dir: false }
    ])
  })
})

describe('rankMentions', () => {
  const entries = withDirs([
    'README.md',
    'src/main/index.ts',
    'src/renderer/src/components/chat/Composer.vue',
    'docs/composer-notas.md',
    'tests/unit/composer.test.ts'
  ])
  const paths = (q: string, limit?: number): string[] =>
    rankMentions(entries, q, limit).map((e) => e.path)

  it('sin consulta, el primer nivel', () => {
    expect(paths('')).toEqual(['src', 'docs', 'tests', 'README.md'])
  })

  it('el nombre que empieza por la consulta va antes, luego lo menos profundo', () => {
    expect(paths('compo')).toEqual([
      'docs/composer-notas.md',
      'tests/unit/composer.test.ts',
      'src/renderer/src/components',
      'src/renderer/src/components/chat/Composer.vue',
      'src/renderer/src/components/chat'
    ])
  })

  it('con `/` busca en la ruta y admite subsecuencias', () => {
    expect(paths('src/main')).toEqual(['src/main', 'src/main/index.ts'])
    expect(paths('srmidx')).toEqual(['src/main/index.ts'])
    expect(paths('src\\main', 1)).toEqual(['src/main'])
  })

  it('sin coincidencias, vacío', () => {
    expect(paths('zzz')).toEqual([])
  })
})

describe('createFileMentions', () => {
  function setup(): { root: string; claude: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bitacora-mentions-')))
    dirs.push(root)
    for (const d of ['src', 'node_modules/pkg', '.claude', '.git'])
      mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, 'src', 'app.ts'), '')
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '')
    writeFileSync(join(root, '.claude', 'settings.json'), '')
    writeFileSync(join(root, '.git', 'HEAD'), '')
    return { root, claude: join(root, '.claude') }
  }

  it('sin Git recorre la carpeta sin las pesadas ni la de Claude Code', async () => {
    const { root, claude } = setup()
    const mentions = createFileMentions({ claudeDir: () => claude, run: noGit })
    expect(await mentions.suggest(root, '')).toEqual([{ path: 'src', dir: true }])
    expect(await mentions.suggest(root, 'index')).toEqual([])
    expect(await mentions.suggest(root, 'settings')).toEqual([])
    expect(await mentions.suggest(root, 'app')).toEqual([{ path: 'src/app.ts', dir: false }])
  })

  it('con Git usa su lista y aun así quita la carpeta de Claude Code', async () => {
    const { root, claude } = setup()
    const run = gitWith(['src/app.ts', '.claude/settings.json', 'src/app.ts'])
    const mentions = createFileMentions({ claudeDir: () => claude, run })
    expect(await mentions.suggest(root, 'a')).toEqual([{ path: 'src/app.ts', dir: false }])
    expect(await mentions.suggest(root, 'settings')).toEqual([])
  })

  it('guarda la lista unos segundos', async () => {
    const { root, claude } = setup()
    let calls = 0
    let at = 0
    const run: GitRun = async (...args) => {
      calls++
      return gitWith(['a.ts'])(...args)
    }
    const mentions = createFileMentions({ claudeDir: () => claude, run, now: () => at })
    await mentions.suggest(root, '')
    await mentions.suggest(root, 'a')
    expect(calls).toBe(1)
    at = 60_000
    await mentions.suggest(root, '')
    expect(calls).toBe(2)
  })
})
