import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { langOf, readDiff, readPreview } from '../../src/main/services/file-preview'
import { createGitService } from '../../src/main/services/git'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bitacora-preview-')))
  dirs.push(dir)
  return dir
}

// PNG de 1×1 transparente.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

describe('readPreview', () => {
  it('texto con lenguaje, Markdown, imagen como data:, binario, ausente y secreto', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.ts'), '﻿export const a = 1\n')
    writeFileSync(join(dir, 'notas.md'), '# Hola\n')
    writeFileSync(join(dir, 'p.png'), PNG)
    writeFileSync(join(dir, 'b.bin'), Buffer.from([1, 2, 0, 3]))
    writeFileSync(join(dir, '.env'), 'CLAVE=1')

    expect(await readPreview(join(dir, 'a.ts'), 'a.ts')).toMatchObject({
      kind: 'text',
      text: 'export const a = 1\n',
      lang: 'ts',
      truncated: false
    })
    expect(await readPreview(join(dir, 'notas.md'), 'notas.md')).toMatchObject({
      kind: 'markdown',
      text: '# Hola\n'
    })
    const image = await readPreview(join(dir, 'p.png'), 'p.png')
    expect(image.kind === 'image' && image.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(await readPreview(join(dir, 'b.bin'), 'b.bin')).toMatchObject({ kind: 'binary' })
    expect(await readPreview(join(dir, 'no.txt'), 'no.txt')).toEqual({
      kind: 'missing',
      path: 'no.txt'
    })
    expect(await readPreview(join(dir, '.env'), '.env')).toEqual({ kind: 'secret', path: '.env' })
  })

  it('recorta los textos de más de 1 MB sin partir caracteres', async () => {
    const dir = tempDir()
    const big = 'ñ'.repeat(600 * 1024) // 1,2 MB en UTF-8
    writeFileSync(join(dir, 'big.txt'), big)
    const preview = await readPreview(join(dir, 'big.txt'), 'big.txt')
    expect(preview).toMatchObject({ kind: 'text', truncated: true })
    if (preview.kind === 'text') {
      expect(preview.text.length).toBe(512 * 1024)
      expect(preview.text.endsWith('ñ')).toBe(true)
    }
  })

  it('imágenes de más de 10 MB no se cargan', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'g.png'), Buffer.alloc(10 * 1024 * 1024 + 1))
    expect(await readPreview(join(dir, 'g.png'), 'g.png')).toMatchObject({ kind: 'too-large' })
  })
})

describe('langOf', () => {
  it('extensión, alias y nombres conocidos', () => {
    expect(langOf('src/App.vue')).toBe('vue')
    expect(langOf('x.h')).toBe('c')
    expect(langOf('Dockerfile')).toBe('bash')
    expect(langOf('LICENSE')).toBe('text')
  })
})

describe('readDiff', () => {
  it('modificado, nuevo, borrado, sin cambios y fuera de un repositorio', async () => {
    const repo = tempDir()
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=P', '-c', 'user.email=p@e.com', ...args], {
        cwd: repo,
        stdio: 'ignore'
      })
    }
    git('init', '-b', 'main')
    git('config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'a.txt'), 'uno\ndos\n')
    writeFileSync(join(repo, 'igual.txt'), 'x\n')
    writeFileSync(join(repo, 'borrar.txt'), 'adiós\n')
    git('add', '.')
    git('commit', '-m', 'inicio')
    writeFileSync(join(repo, 'a.txt'), 'uno\r\ntres\r\n')
    writeFileSync(join(repo, 'nuevo.txt'), 'hola\n')
    unlinkSync(join(repo, 'borrar.txt'))

    const service = createGitService()
    expect(await readDiff(join(repo, 'a.txt'), 'a.txt', service, repo)).toEqual({
      kind: 'text',
      path: 'a.txt',
      before: 'uno\ndos\n',
      after: 'uno\ntres\n'
    })
    expect(await readDiff(join(repo, 'nuevo.txt'), 'nuevo.txt', service, repo)).toMatchObject({
      before: null,
      after: 'hola\n'
    })
    expect(await readDiff(join(repo, 'borrar.txt'), 'borrar.txt', service, repo)).toMatchObject({
      before: 'adiós\n',
      after: null
    })
    expect(await readDiff(join(repo, 'igual.txt'), 'igual.txt', service, repo)).toMatchObject({
      kind: 'unchanged'
    })
    const plain = tempDir()
    writeFileSync(join(plain, 'a.txt'), 'x')
    expect(await readDiff(join(plain, 'a.txt'), 'a.txt', service, plain)).toMatchObject({
      kind: 'not-repo'
    })
  })
})
