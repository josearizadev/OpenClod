import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ClaudeMdError,
  hashText,
  readClaudeMd,
  writeClaudeMd
} from '../../src/main/services/claude-md'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(): { root: string; claude: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bitacora-md-')))
  dirs.push(base)
  const root = join(base, 'proyecto')
  const claude = join(base, 'claude-data')
  mkdirSync(root)
  mkdirSync(claude)
  return { root, claude }
}

describe('CLAUDE.md', () => {
  it('sin archivo: vacío; crear con hash null; después lee el mismo texto', async () => {
    const { root, claude } = setup()
    const empty = await readClaudeMd(root, claude)
    expect(empty).toMatchObject({ path: join(root, 'CLAUDE.md'), exists: false, hash: null })
    const written = await writeClaudeMd(root, claude, '# Reglas\n', null)
    expect(written).toMatchObject({
      ok: true,
      file: { exists: true, hash: hashText('# Reglas\n') }
    })
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# Reglas\n')
    // Sin temporales sueltos.
    expect(readdirSync(root)).toEqual(['CLAUDE.md'])
  })

  it('no sobrescribe si cambió en disco desde que se leyó', async () => {
    const { root, claude } = setup()
    writeFileSync(join(root, 'CLAUDE.md'), 'v1')
    const read = await readClaudeMd(root, claude)
    writeFileSync(join(root, 'CLAUDE.md'), 'v2 de Claude')
    const result = await writeClaudeMd(root, claude, 'mío', read.hash)
    expect(result).toMatchObject({ ok: false, reason: 'conflict', file: { text: 'v2 de Claude' } })
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('v2 de Claude')
    // Crear cuando ya existe también es un conflicto.
    expect(await writeClaudeMd(root, claude, 'x', null)).toMatchObject({ ok: false })
  })

  it('usa .claude/CLAUDE.md si es el único', async () => {
    const { root, claude } = setup()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'CLAUDE.md'), 'anidado')
    expect(await readClaudeMd(root, claude)).toMatchObject({
      path: join(root, '.claude', 'CLAUDE.md'),
      text: 'anidado'
    })
  })

  it('rechaza el de la carpeta de Claude Code (proyecto = carpeta personal)', async () => {
    const { root } = setup()
    mkdirSync(join(root, '.claude'))
    writeFileSync(join(root, '.claude', 'CLAUDE.md'), 'personal')
    await expect(readClaudeMd(root, join(root, '.claude'))).rejects.toBeInstanceOf(ClaudeMdError)
  })

  it('rechaza más de 1 MB', async () => {
    const { root, claude } = setup()
    await expect(writeClaudeMd(root, claude, 'x'.repeat(1024 * 1024 + 1), null)).rejects.toThrow(
      /demasiado grande/
    )
  })
})
