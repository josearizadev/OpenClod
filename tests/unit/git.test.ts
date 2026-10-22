import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGitService,
  parseStatus,
  parseWorktrees,
  type GitRun
} from '../../src/main/services/git'
import { normalizePath } from '../../src/main/services/paths'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bitacora-git-')))
  dirs.push(dir)
  return dir
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Prueba', '-c', 'user.email=p@example.com', ...args], {
    cwd,
    stdio: 'ignore'
  })
}

describe('parseStatus', () => {
  it('lee rama, remota, ↑↓ y los cuatro tipos de entrada', () => {
    const text = [
      '# branch.oid 0123456789abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
      '1 A. N... 000000 100644 100644 000 bbb docs/nueva nota.md',
      '1 D. N... 100644 000000 000000 aaa 000 viejo.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/nuevo.ts',
      'src/antiguo.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflicto.ts',
      '? sin seguimiento/ñandú.txt',
      'x desconocido',
      ''
    ].join('\0')
    const status = parseStatus(text, '/repo')
    expect(status).toMatchObject({
      root: '/repo',
      branch: 'main',
      head: '0123456',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      truncated: false
    })
    expect(status.files).toEqual([
      { path: 'conflicto.ts', kind: 'conflict', staged: false, unstaged: true },
      { path: 'docs/nueva nota.md', kind: 'added', staged: true, unstaged: false },
      { path: 'sin seguimiento/ñandú.txt', kind: 'untracked', staged: false, unstaged: true },
      { path: 'src/app.ts', kind: 'modified', staged: false, unstaged: true },
      {
        path: 'src/nuevo.ts',
        origPath: 'src/antiguo.ts',
        kind: 'renamed',
        staged: true,
        unstaged: false
      },
      { path: 'viejo.txt', kind: 'deleted', staged: true, unstaged: false }
    ])
  })

  it('HEAD separado y repositorio sin commits', () => {
    expect(parseStatus('# branch.oid abcdef1234\0# branch.head (detached)\0', '/r')).toMatchObject({
      branch: null,
      head: 'abcdef1'
    })
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0', '/r')).toMatchObject({
      branch: 'main',
      head: null,
      upstream: null,
      ahead: 0
    })
  })

  it('recorta a 2000 archivos', () => {
    const text = Array.from({ length: 2005 }, (_, i) => `? f${String(i).padStart(4, '0')}`).join(
      '\0'
    )
    const status = parseStatus(text, '/r')
    expect(status.files).toHaveLength(2000)
    expect(status.truncated).toBe(true)
  })
})

describe('parseWorktrees', () => {
  it('lee rama, HEAD, separado y bare', () => {
    const text = [
      'worktree /repo',
      'HEAD 0123456789',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD abcdef0123',
      'detached',
      '',
      'worktree /repo.git',
      'bare',
      ''
    ].join('\n')
    expect(parseWorktrees(text)).toEqual([
      {
        path: normalizePath('/repo'),
        head: '0123456',
        branch: 'main',
        detached: false,
        bare: false
      },
      {
        path: normalizePath('/repo-feature'),
        head: 'abcdef0',
        branch: null,
        detached: true,
        bare: false
      },
      { path: normalizePath('/repo.git'), head: null, branch: null, detached: false, bare: true }
    ])
  })
})

describe('GitService con un repositorio real', () => {
  it('info: rama, cambios, worktrees y proyecto importado; null fuera de un repositorio', async () => {
    const repo = tempDir()
    git(repo, 'init', '-b', 'main')
    writeFileSync(join(repo, 'a.txt'), 'uno\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'inicio')
    writeFileSync(join(repo, 'a.txt'), 'dos\n')
    mkdirSync(join(repo, 'sub'))
    writeFileSync(join(repo, 'sub', 'b.txt'), 'nuevo\n')

    const service = createGitService({ projects: () => [{ id: 'p1', path: repo }] })
    const info = await service.info(join(repo, 'sub'))
    expect(info?.status.root).toBe(normalizePath(repo))
    expect(info?.status.branch).toBe('main')
    expect(info?.status.files.map((f) => [f.path, f.kind])).toEqual([
      ['a.txt', 'modified'],
      ['sub/b.txt', 'untracked']
    ])
    expect(info?.worktrees).toEqual([
      expect.objectContaining({ current: true, branch: 'main', projectId: 'p1' })
    ])

    const blob = await service.blobAtHead(normalizePath(repo), 'a.txt', 1024)
    expect(blob?.kind === 'ok' && blob.data.toString('utf8')).toBe('uno\n')
    expect(await service.blobAtHead(normalizePath(repo), 'sub/b.txt', 1024)).toEqual({
      kind: 'missing'
    })
    expect(await service.blobAtHead(normalizePath(repo), 'a.txt', 2)).toEqual({
      kind: 'too-large',
      size: 4
    })

    expect(await service.info(tempDir())).toBeNull()
    expect(await service.version()).toMatch(/^\d+\.\d+/)
  })

  it('cachea 1 s y comparte la consulta en vuelo', async () => {
    let clock = 0
    const calls: string[] = []
    const run: GitRun = async (args) => {
      calls.push(args[0]!)
      if (args[0] === 'rev-parse') return { ok: true, stdout: Buffer.from('/repo\n') }
      if (args[0] === 'status') return { ok: true, stdout: Buffer.from('# branch.head main\0') }
      return { ok: true, stdout: Buffer.from('') }
    }
    const service = createGitService({ run, now: () => clock })
    const [a, b] = await Promise.all([service.info('/repo'), service.info('/repo')])
    expect(a).toBe(b)
    expect(calls.filter((c) => c === 'status')).toHaveLength(1)
    clock = 500
    await service.info('/repo')
    expect(calls.filter((c) => c === 'status')).toHaveLength(1)
    await service.info('/repo', { fresh: true })
    expect(calls.filter((c) => c === 'status')).toHaveLength(2)
    clock = 2000
    await service.info('/repo')
    expect(calls.filter((c) => c === 'status')).toHaveLength(3)
  })

  it('sin Git instalado devuelve null y lo registra', async () => {
    const warn = vi.fn()
    const run: GitRun = async () => ({ ok: false, missing: true, message: 'spawn git ENOENT' })
    const service = createGitService({ run, log: { warn } })
    expect(await service.info('/x')).toBeNull()
    expect(await service.version()).toBeNull()
    expect(warn).toHaveBeenCalledWith('git', 'Git no está instalado')
  })
})
