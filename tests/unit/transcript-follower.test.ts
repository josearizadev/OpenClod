import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptAppend } from '../../src/shared/sessions'
import { sessionRefFromFile } from '../../src/main/services/claude-paths'
import { loadSession } from '../../src/main/services/session-loader'
import { createTranscriptFollower } from '../../src/main/services/transcript-follower'

const NUBE = join(__dirname, '../fixtures/claude/projects/Z--web-Nube')
const BIG = '0e56deca-67ad-4d7c-bc94-a61cc14540cd'
const CONTINUED = 'a55accdd-171f-4711-936e-b51294a4b423'
const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-follow-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function lines(id: string): string[] {
  return readFileSync(join(NUBE, `${id}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
}

/** Sigue una copia que empieza con las `start` primeras líneas. */
async function follow(
  id: string,
  start: number,
  withSubagents = false
): Promise<{
  file: string
  events: TranscriptAppend[]
  f: ReturnType<typeof createTranscriptFollower>
}> {
  const file = join(dir, `${id}.jsonl`)
  writeFileSync(file, lines(id).slice(0, start).join('\n') + '\n')
  if (withSubagents) cpSync(join(NUBE, id), join(dir, id), { recursive: true })
  const events: TranscriptAppend[] = []
  const f = createTranscriptFollower({
    emit: (_target, event) => events.push(event),
    resolveEntry: (sid) => `entrada-${sid}`,
    log: quiet
  })
  const loaded = await loadSession(await sessionRefFromFile(file), { keep: true })
  f.track(1, id, file, loaded.follow!)
  return { file, events, f }
}

describe('TranscriptFollower', () => {
  it('los elementos por trozos son iguales a los de una lectura completa', async () => {
    const all = lines(BIG)
    const { file, events, f } = await follow(BIG, 100, true)
    const initial = (await loadSession(await sessionRefFromFile(file))).items
    for (let i = 100; i < all.length; i += 250) {
      appendFileSync(file, all.slice(i, i + 250).join('\n') + '\n')
      await f.onPaths([file])
    }
    const full = await loadSession(await sessionRefFromFile(join(NUBE, `${BIG}.jsonl`)))
    const received = events.flatMap((e) => e.items)
    expect([...initial, ...received]).toEqual(full.items)
    expect(events.every((e) => !e.reset)).toBe(true)
  })

  it('una línea a medio escribir espera a la siguiente lectura', async () => {
    const all = lines(BIG)
    const { file, events, f } = await follow(BIG, 50)
    const next = all[50] as string
    appendFileSync(file, next.slice(0, 40))
    await f.onPaths([file])
    expect(events).toHaveLength(0)
    appendFileSync(file, next.slice(40) + '\n' + all.slice(51, 70).join('\n') + '\n')
    await f.onPaths([file])
    expect(events.flatMap((e) => e.items)[0]?.line).toBeGreaterThanOrEqual(51)
  })

  it('sin nada nuevo no emite; rutas ajenas se ignoran', async () => {
    const { file, events, f } = await follow(BIG, 50)
    await f.onPaths([file])
    await f.onPaths([join(dir, 'otra.jsonl')])
    await f.onPaths([])
    expect(events).toHaveLength(0)
  })

  it('archivo que encoge o se borra → reset y deja de seguir', async () => {
    const { file, events, f } = await follow(BIG, 80)
    writeFileSync(file, lines(BIG).slice(0, 10).join('\n') + '\n')
    await f.onPaths([file])
    expect(events).toEqual([expect.objectContaining({ sessionId: BIG, reset: true })])
    expect(f.size).toBe(0)

    const second = await follow(BIG, 80)
    rmSync(second.file)
    await second.f.onPaths([second.file])
    expect(second.events[0]?.reset).toBe(true)
  })

  it('subagente nuevo con su .meta.json', async () => {
    const { file, events, f } = await follow(BIG, 1159)
    cpSync(join(NUBE, BIG), join(dir, BIG), { recursive: true })
    const agent = join(dir, BIG, 'subagents', 'agent-a45f6265eb93d3ccc.jsonl')
    await f.onPaths([agent])
    const event = events[0] as TranscriptAppend
    expect(event.items).toEqual([])
    expect(event.subagents?.map((s) => s.agentId).sort()).toEqual([
      'a45f6265eb93d3ccc',
      'a87cb1297b966067e'
    ])
    expect(event.subagents?.[0]?.agentType).toBeDefined()
    expect(event.subagentItems?.['a45f6265eb93d3ccc']?.length).toBeGreaterThan(0)
    // Una segunda pasada sin cambios no emite.
    await f.onPaths([file])
    expect(events).toHaveLength(1)
  })

  it('continued-in se resuelve con el índice', async () => {
    const all = lines(CONTINUED)
    const { file, events, f } = await follow(CONTINUED, 70)
    appendFileSync(file, all.slice(70).join('\n') + '\n')
    await f.onPaths([file])
    expect(events.at(-1)?.continuedIn).toBe('entrada-9c81d504-7ee7-4a60-a274-500078e29ce3')
  })
})
