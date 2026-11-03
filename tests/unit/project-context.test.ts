import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../src/main/services/app-store'
import { createProjectContext } from '../../src/main/services/project-context'
import { CONTEXT_SEND_MAX, isContextName } from '../../src/shared/context'
import { invokeContract } from '../../src/shared/ipc-contract'

const quiet = { warn: (): void => {} }
const P = '6f1c2b4e-8d3a-4f5b-9c7e-1a2b3c4d5e6f'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(): {
  root: string
  service: ReturnType<typeof createProjectContext>
  trashed: string[]
  store: ReturnType<typeof createAppStore>
} {
  const root = mkdtempSync(join(tmpdir(), 'openclod-contexto-'))
  dirs.push(root)
  const store = createAppStore(join(root, 'state.json'), quiet)
  const trashed: string[] = []
  const service = createProjectContext({
    root: join(root, 'contexto'),
    store,
    trash: async (path) => {
      trashed.push(path)
      rmSync(path)
    }
  })
  return { root, service, trashed, store }
}

describe('nombres', () => {
  it.each(['notas.md', 'Convenciones del equipo.MD', 'a.b.md', 'ñandú.md'])('acepta %s', (n) => {
    expect(isContextName(n)).toBe(true)
  })
  it.each([
    '.md',
    'notas.txt',
    '../x.md',
    'a/b.md',
    'a\\b.md',
    'con:dos.md',
    ' x.md',
    '.oculto.md'
  ])('rechaza %s', (n) => {
    expect(isContextName(n)).toBe(false)
  })
  it('zod: write rechaza nombres con rutas y projectId que no es uuid', () => {
    const input = invokeContract['context:write'].input
    expect(
      input.safeParse({ projectId: P, name: '../x.md', text: '', expectedHash: null }).success
    ).toBe(false)
    expect(
      input.safeParse({ projectId: 'x', name: 'a.md', text: '', expectedHash: null }).success
    ).toBe(false)
    expect(
      input.safeParse({ projectId: P, name: 'a.md', text: '', expectedHash: null }).success
    ).toBe(true)
  })
})

describe('archivos de contexto', () => {
  it('crear, listar, leer y guardar sin pisar cambios', async () => {
    const { service } = setup()
    expect(await service.list(P)).toMatchObject({ files: [] })
    const created = await service.write(P, 'b.md', '# B', null)
    expect(created.ok).toBe(true)
    // Crear otra vez (también con otras mayúsculas) es conflicto.
    expect((await service.write(P, 'B.md', 'x', null)).ok).toBe(false)
    await service.write(P, 'a.md', 'A', null)
    const listing = await service.list(P)
    expect(listing.files.map((f) => [f.name, f.enabled])).toEqual([
      ['a.md', true],
      ['b.md', true]
    ])
    const file = await service.read(P, 'b.md')
    expect(file.text).toBe('# B')
    // Alguien lo cambia fuera: guardar con el hash viejo no lo pisa.
    writeFileSync(join(listing.dir, 'b.md'), 'cambiado fuera')
    const stale = await service.write(P, 'b.md', 'mío', file.hash)
    expect(stale).toMatchObject({ ok: false, reason: 'conflict', file: { text: 'cambiado fuera' } })
    const fresh = await service.read(P, 'b.md')
    expect((await service.write(P, 'b.md', 'mío', fresh.hash)).ok).toBe(true)
    expect(readFileSync(join(listing.dir, 'b.md'), 'utf8')).toBe('mío')
  })

  it('ignora lo que no es .md y carpetas; leer uno que no existe → NOT_FOUND', async () => {
    const { service } = setup()
    const dir = await service.ensureDir(P)
    writeFileSync(join(dir, 'x.txt'), 'no')
    mkdirSync(join(dir, 'sub.md'))
    writeFileSync(join(dir, 'si.md'), 'sí')
    expect((await service.list(P)).files.map((f) => f.name)).toEqual(['si.md'])
    await expect(service.read(P, 'no.md')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(service.read(P, '../x.md')).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })

  it('desactivar, renombrar (conserva el estado) y eliminar a la papelera', async () => {
    const { service, store, trashed } = setup()
    await service.write(P, 'a.md', 'A', null)
    await service.write(P, 'b.md', 'B', null)
    service.setEnabled(P, 'a.md', false)
    expect(store.get().projectContext[P]).toEqual({ disabled: ['a.md'] })
    await service.rename(P, 'a.md', 'z.md')
    expect((await service.list(P)).files.map((f) => [f.name, f.enabled])).toEqual([
      ['b.md', true],
      ['z.md', false]
    ])
    await expect(service.rename(P, 'b.md', 'Z.md')).rejects.toMatchObject({
      code: 'INVALID_ARGS'
    })
    await service.remove(P, 'z.md')
    expect(trashed).toHaveLength(1)
    expect(store.get().projectContext).toEqual({})
    await expect(service.remove(P, 'z.md')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('compose', () => {
  it('activos en orden alfabético y luego la carpeta, con cabeceras', async () => {
    const { service } = setup()
    await service.write(P, 'b.md', 'Segundo', null)
    await service.write(P, 'a.md', 'Primero', null)
    await service.write(P, 'c.md', 'Desactivado', null)
    await service.write(P, 'vacio.md', '   ', null)
    service.setEnabled(P, 'c.md', false)
    const out = await service.compose({
      projectId: P,
      folder: { name: 'Migración', context: 'Contexto de la tarea' }
    })
    expect(out.parts).toEqual([
      { kind: 'file', name: 'a.md', chars: 7 },
      { kind: 'file', name: 'b.md', chars: 7 },
      { kind: 'folder', name: 'Migración', chars: 20 }
    ])
    expect(out.text.indexOf('Primero')).toBeLessThan(out.text.indexOf('Segundo'))
    expect(out.text.indexOf('Segundo')).toBeLessThan(out.text.indexOf('Contexto de la tarea'))
    expect(out.text).not.toContain('Desactivado')
    expect(out.text).toContain('a.md')
    expect(out.text.startsWith('<openclod-context>')).toBe(true)
    expect(out.truncated).toBe(false)
  })

  it('sin nada → texto vacío; recorta lo que pasa del máximo', async () => {
    const { service } = setup()
    expect(await service.compose({ projectId: P, folder: null })).toEqual({
      text: '',
      parts: [],
      chars: 0,
      truncated: false
    })
    expect(
      (await service.compose({ projectId: null, folder: { name: 'x', context: ' ' } })).text
    ).toBe('')
    await service.write(P, 'grande.md', 'x'.repeat(150_000), null)
    const out = await service.compose({ projectId: P, folder: null })
    expect(out.truncated).toBe(true)
    expect(out.chars).toBeGreaterThan(CONTEXT_SEND_MAX)
    expect(out.text.length).toBeLessThan(CONTEXT_SEND_MAX + 100)
    expect(out.text.endsWith('</openclod-context>')).toBe(true)
  })
})

describe('contexto aplicado', () => {
  it('se guarda por conversación, se lee y se olvida; ids con rutas no', async () => {
    const { service, root } = setup()
    await service.saveApplied('conv-1', 'contexto fijo')
    await service.saveApplied('../fuera', 'no')
    expect(await service.readApplied('conv-1')).toBe('contexto fijo')
    expect(await service.readApplied('conv-2')).toBeNull()
    expect(existsSync(join(root, 'fuera.md'))).toBe(false)
    await service.forgetApplied(['conv-1'])
    expect(await service.readApplied('conv-1')).toBeNull()
  })
})
