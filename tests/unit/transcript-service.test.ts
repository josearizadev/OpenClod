import type Database from 'better-sqlite3'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjects } from '../../src/main/services/claude-paths'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { loadContinuation } from '../../src/main/services/session-loader'
import {
  createTranscriptService,
  segmentsOf,
  TranscriptReadError
} from '../../src/main/services/transcript'

const FIXTURES = join(__dirname, '../fixtures/claude')
const ORIGIN = 'a55accdd-171f-4711-936e-b51294a4b423'
const CONTINUATION = '9c81d504-7ee7-4a60-a274-500078e29ce3'
const WITH_SUBAGENTS = '0e56deca-67ad-4d7c-bc94-a61cc14540cd'
const NUBE_RECENT = '07319c10-f4d8-43f5-b876-ec4c89ae65d4'

const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
const dirs: string[] = []
const connections: Database.Database[] = []

afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup(): Promise<{
  claudeDir: string
  db: Database.Database
  service: ReturnType<typeof createTranscriptService>
}> {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-transcript-'))
  dirs.push(root)
  const claudeDir = join(root, 'claude')
  cpSync(FIXTURES, claudeDir, { recursive: true })
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  connections.push(opened.db)
  await runPass(opened.db, claudeDir, quiet)
  const service = createTranscriptService({
    reader: opened.db,
    claudeDir: () => claudeDir,
    log: quiet
  })
  return { claudeDir, db: opened.db, service }
}

function nube(claudeDir: string, id: string): string {
  return join(claudeDir, 'projects', 'Z--web-Nube', `${id}.jsonl`)
}

/** `mtime` de todos los archivos de una carpeta, recursivo. */
function mtimes(dir: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    out.set(file, statSync(file).mtimeMs)
  }
  return out
}

describe('TranscriptService', () => {
  it('sesión suelta: un segmento, elementos sin subagentes y datos del resumen', async () => {
    const { service } = await setup()
    const payload = await service.transcript(NUBE_RECENT)
    expect(payload).not.toBeNull()
    expect(payload?.sessionId).toBe(NUBE_RECENT)
    expect(payload?.segments).toHaveLength(1)
    expect(payload?.segments[0]).toMatchObject({ sessionId: NUBE_RECENT })
    expect(payload?.items.length).toBeGreaterThan(0)
    expect(payload?.items.some((i) => i.inherited)).toBe(false)
    expect(payload?.cwd).toBe('Z:\\web\\Nube')
    expect(payload?.updatedAt).toBeTruthy()
  })

  it('subagentes: solo los del principal en `items` y la lista con tipo y recuentos', async () => {
    const { service } = await setup()
    const payload = await service.transcript(WITH_SUBAGENTS)
    expect(payload?.items.every((i) => !i.sidechain)).toBe(true)
    expect(payload?.subagents.map((s) => s.agentId).sort()).toEqual([
      'a45f6265eb93d3ccc',
      'a87cb1297b966067e'
    ])
    expect(payload?.subagents.every((s) => s.messageCount > 0)).toBe(true)
    expect(payload?.items.some((i) => i.kind === 'subagent-ref')).toBe(true)
  })

  it('continuación: dos segmentos, `firstLine` en la primera línea propia e `inherited` en lo copiado', async () => {
    const { claudeDir, db, service } = await setup()
    const payload = await service.transcript(CONTINUATION)
    expect(payload?.segments.map((s) => s.sessionId)).toEqual([ORIGIN, CONTINUATION])

    const until = db
      .prepare<[string], number>('SELECT inherited_until_line FROM sessions WHERE session_id = ?')
      .pluck()
      .get(CONTINUATION) as number
    expect(until).toBeGreaterThan(0)
    const own = payload?.segments[1]
    const firstOwn = payload?.items.find((i) => i.line > until && i.uuid)
    expect(own?.firstLine).toBeGreaterThan(until)
    expect(own?.firstLine).toBeLessThanOrEqual(firstOwn?.line ?? 0)
    expect(own?.startedAt).toBeTruthy()

    // Lo heredado coincide con lo que calcula el cargador completo comparando los archivos.
    const listed = await listProjects(claudeDir)
    if (!listed.ok) throw new Error(listed.reason)
    const refs = listed.projects.flatMap((p) => p.sessions)
    const ref = (id: string): (typeof refs)[number] => refs.find((r) => r.sessionId === id)!
    const expected = await loadContinuation(ref(CONTINUATION), ref(ORIGIN))
    const inheritedLines = (items: { line: number; uuid?: string; inherited?: true }[]): number[] =>
      items.filter((i) => i.uuid && i.inherited).map((i) => i.line)
    expect(inheritedLines(payload?.items ?? [])).toEqual(inheritedLines(expected.items))
    expect(
      payload?.items.filter((i) => i.line >= (own?.firstLine ?? 0)).some((i) => i.inherited)
    ).toBe(false)
  })

  it('la sesión de origen de la conversación no tiene «Reanudada aquí»', async () => {
    const { service } = await setup()
    const payload = await service.transcript(ORIGIN)
    expect(payload?.segments.map((s) => s.sessionId)).toEqual([ORIGIN])
  })

  it('sesión desconocida → null', async () => {
    const { service } = await setup()
    expect(await service.transcript('no-existe')).toBeNull()
    expect(await service.subagent('no-existe', 'a45f6265eb93d3ccc')).toBeNull()
  })

  it('fuera de la carpeta de Claude Code (índice de otra carpeta) → null', async () => {
    const { db } = await setup()
    const other = mkdtempSync(join(tmpdir(), 'bitacora-otra-'))
    dirs.push(other)
    const service = createTranscriptService({ reader: db, claudeDir: () => other, log: quiet })
    expect(await service.transcript(NUBE_RECENT)).toBeNull()
    expect(await service.subagent(WITH_SUBAGENTS, 'a45f6265eb93d3ccc')).toBeNull()
  })

  it('archivo borrado tras indexar → null', async () => {
    const { claudeDir, service } = await setup()
    rmSync(nube(claudeDir, NUBE_RECENT))
    expect(await service.transcript(NUBE_RECENT)).toBeNull()
  })

  it('archivo ilegible (una carpeta en su lugar) → TranscriptReadError', async () => {
    const { claudeDir, service } = await setup()
    const file = nube(claudeDir, NUBE_RECENT)
    rmSync(file)
    mkdirSync(file)
    await expect(service.transcript(NUBE_RECENT)).rejects.toBeInstanceOf(TranscriptReadError)
  })

  it('sin índice → TranscriptReadError', async () => {
    const service = createTranscriptService({ reader: null, claudeDir: () => '', log: quiet })
    await expect(service.transcript(NUBE_RECENT)).rejects.toBeInstanceOf(TranscriptReadError)
  })

  it('subagente propio, ajeno a la sesión o inexistente', async () => {
    const { service } = await setup()
    const own = await service.subagent(WITH_SUBAGENTS, 'a45f6265eb93d3ccc')
    expect(own?.agentId).toBe('a45f6265eb93d3ccc')
    expect(own?.items.length).toBeGreaterThan(0)
    expect(own?.items.every((i) => i.sidechain)).toBe(true)
    // `a3aa898a77e40ab58` existe, pero cuelga de otra sesión.
    expect(await service.subagent(WITH_SUBAGENTS, 'a3aa898a77e40ab58')).toBeNull()
    expect(await service.subagent(WITH_SUBAGENTS, 'nada')).toBeNull()
  })

  it('no cambia la fecha de ningún archivo de la carpeta de Claude Code', async () => {
    const { claudeDir, service } = await setup()
    const before = mtimes(claudeDir)
    for (const id of [ORIGIN, CONTINUATION, WITH_SUBAGENTS, NUBE_RECENT]) {
      await service.transcript(id)
    }
    await service.subagent(WITH_SUBAGENTS, 'a87cb1297b966067e')
    expect(mtimes(claudeDir)).toEqual(before)
  })
})

describe('resumeTarget', () => {
  it('una conversación continuada reanuda su última sesión, con su carpeta y su modelo', async () => {
    const { db, service } = await setup()
    const target = service.resumeTarget(ORIGIN)
    expect(target).toEqual({
      sessionId: CONTINUATION,
      cwd: expect.stringMatching(/Nube$/i),
      model: expect.stringMatching(/^claude-/)
    })
    expect(service.resumeTarget(CONTINUATION)).toEqual(target)
    const last = db
      .prepare<[string], { model: string }>(
        'SELECT model FROM session_usage WHERE session_id = ? AND agent_id IS NULL ORDER BY timestamp DESC LIMIT 1'
      )
      .get(CONTINUATION)
    expect(target?.model).toBe(last?.model)
  })

  it('una sesión suelta se reanuda a sí misma; una desconocida → null', async () => {
    const { service } = await setup()
    expect(service.resumeTarget(NUBE_RECENT)?.sessionId).toBe(NUBE_RECENT)
    expect(service.resumeTarget('00000000-0000-4000-8000-00000000dead')).toBeNull()
  })

  it('sin índice → null', () => {
    const service = createTranscriptService({ reader: null, claudeDir: () => 'x', log: quiet })
    expect(service.resumeTarget(ORIGIN)).toBeNull()
  })
})

describe('segmentsOf', () => {
  const item = (line: number, uuid?: string): Parameters<typeof segmentsOf>[1][number] => ({
    kind: 'meta',
    text: '',
    line,
    sidechain: false,
    ...(uuid ? { uuid } : {}),
    timestamp: `2026-10-0${Math.min(line, 9)}T10:00:00.000Z`
  })

  it('cadena de tres sesiones: cada elemento va a la primera que lo contiene', () => {
    const items = [item(1, 'a'), item(2, 'b'), item(3), item(4, 'c'), item(5, 'd'), item(6)]
    const { items: out, segments } = segmentsOf('C', items, [
      { sessionId: 'A', uuids: new Set(['a', 'b']) },
      { sessionId: 'B', uuids: new Set(['a', 'b', 'c']) }
    ])
    expect(segments.map((s) => [s.sessionId, s.firstLine])).toEqual([
      ['A', 1],
      ['B', 4],
      ['C', 5]
    ])
    expect(out.map((i) => i.inherited ?? false)).toEqual([true, true, true, true, false, false])
  })

  it('un segmento sin líneas se omite', () => {
    const { segments } = segmentsOf(
      'C',
      [item(1, 'x')],
      [{ sessionId: 'A', uuids: new Set(['nada']) }]
    )
    expect(segments.map((s) => s.sessionId)).toEqual(['C'])
  })
})
