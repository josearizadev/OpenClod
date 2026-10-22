import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listProjects, type SessionFileRef } from '../../src/main/services/claude-paths'
import {
  applyLink,
  fingerprintOf,
  linkConversations,
  type SessionFingerprint
} from '../../src/main/services/conversations'
import { loadContinuation, loadSession } from '../../src/main/services/session-loader'
import { addUsage } from '../../src/main/services/usage'
import { EMPTY_USAGE, type UsageEvent } from '../../src/shared/sessions'

const FIXTURES = join(__dirname, '../fixtures/claude')
const A = 'a55accdd-171f-4711-936e-b51294a4b423'
const B = '9c81d504-7ee7-4a60-a274-500078e29ce3'

/** `python scripts/recuento-tokens.py tests/fixtures/claude/projects` → «propio» de 9c81d504. */
const PROPIO_B = { input: 6, output: 2298, cacheCreation: 26861, cacheRead: 286861 }
/** Misma fuente, línea GLOBAL. */
const GLOBAL = { input: 502, output: 329810, cacheCreation: 859933, cacheRead: 47904907 }

function ev(key: string, output: number): UsageEvent {
  return { key, model: 'm', usage: { input: 0, output, cacheCreation: 0, cacheRead: 0 } }
}

function fp(
  sessionId: string,
  uuids: string[],
  usage: UsageEvent[],
  continuedIn?: string
): SessionFingerprint {
  return { sessionId, uuids: new Set(uuids), usage, ...(continuedIn ? { continuedIn } : {}) }
}

async function nubeRefs(): Promise<Map<string, SessionFileRef>> {
  const result = await listProjects(FIXTURES)
  if (!result.ok) throw new Error(result.reason)
  return new Map(result.projects.flatMap((p) => p.sessions.map((s) => [s.sessionId, s] as const)))
}

describe('linkConversations con la sesión continuada real', async () => {
  const refs = await nubeRefs()
  const loaded = await Promise.all([...refs.values()].map((ref) => loadSession(ref)))
  const graph = linkConversations(loaded.map(fingerprintOf))

  it('enlaza A → B con el mismo id de conversación', () => {
    expect(graph.links.get(A)).toMatchObject({ conversationId: A })
    expect(graph.links.get(A)?.continuedFrom).toBeUndefined()
    expect(graph.links.get(B)).toMatchObject({ conversationId: A, continuedFrom: A })
    expect(graph.links.get(B)?.inherited.size).toBe(38)
    expect(graph.unlinkedOverlaps).toEqual([])
    expect(graph.brokenLinks).toEqual([])
  })

  it('el uso propio de B coincide con el recuento independiente', () => {
    expect(graph.links.get(B)?.ownUsage).toEqual(PROPIO_B)
  })

  it('la suma del uso propio de todas las sesiones es el total global sin duplicados', () => {
    const sum = [...graph.links.values()].reduce((acc, l) => addUsage(acc, l.ownUsage), {
      ...EMPTY_USAGE
    })
    expect(sum).toEqual(GLOBAL)
  })

  it('loadContinuation marca lo heredado y rellena el resumen', async () => {
    const refB = refs.get(B)
    const refA = refs.get(A)
    if (!refA || !refB) throw new Error('faltan fixtures')
    const result = await loadContinuation(refB, refA)
    const inherited = result.items.filter((i) => i.inherited)
    expect(new Set(inherited.map((i) => i.uuid)).size).toBe(38)
    expect(result.summary).toMatchObject({
      conversationId: A,
      continuedFrom: A,
      ownUsage: PROPIO_B
    })
    // Lo heredado es el principio del archivo: después solo hay líneas propias.
    const until = result.summary.inheritedUntilLine ?? 0
    expect(until).toBeGreaterThan(0)
    expect(result.items.filter((i) => i.line > until).every((i) => !i.inherited)).toBe(true)
    // El prompt nuevo de B («¿Aún sigue…?») no es heredado.
    const prompts = result.items.filter((i) => i.kind === 'user-prompt')
    expect(prompts.at(-1)?.inherited).toBeUndefined()
  })

  it('sin enlace, una sesión es su propia conversación y todo su uso es propio', async () => {
    const ref = refs.get('0e56deca-67ad-4d7c-bc94-a61cc14540cd')
    if (!ref) throw new Error('falta fixture')
    const { summary } = await loadSession(ref)
    expect(summary.conversationId).toBe(summary.sessionId)
    expect(summary.ownUsage).toEqual(summary.usage)
    expect(summary.continuedFrom).toBeUndefined()
  })
})

describe('linkConversations con datos sintéticos', () => {
  it('cadena A → B → C: cada sesión solo cuenta lo suyo', () => {
    const graph = linkConversations([
      fp('A', ['u1', 'u2'], [ev('m1', 10)], 'B'),
      fp('B', ['u1', 'u2', 'u3'], [ev('m1', 10), ev('m2', 20)], 'C'),
      fp('C', ['u1', 'u2', 'u3', 'u4'], [ev('m1', 10), ev('m2', 20), ev('m3', 30)])
    ])
    expect(graph.links.get('C')).toMatchObject({ conversationId: 'A', continuedFrom: 'B' })
    expect([...(graph.links.get('C')?.inherited ?? [])]).toEqual(['u1', 'u2', 'u3'])
    expect(['A', 'B', 'C'].map((id) => graph.links.get(id)?.ownUsage.output)).toEqual([10, 20, 30])
  })

  it('enlace roto: la sesión queda completa y se informa', () => {
    const graph = linkConversations([fp('A', ['u1'], [ev('m1', 5)], 'X')])
    expect(graph.brokenLinks).toEqual([{ sessionId: 'A', missing: 'X' }])
    expect(graph.links.get('A')).toMatchObject({ conversationId: 'A' })
    expect(graph.links.get('A')?.ownUsage.output).toBe(5)
  })

  it('dos sesiones hacia el mismo destino: se enlaza la primera y la otra se informa', () => {
    const graph = linkConversations([
      fp('A', ['u1'], [], 'C'),
      fp('B', ['u2'], [], 'C'),
      fp('C', ['u1', 'u3'], [])
    ])
    expect(graph.links.get('C')?.continuedFrom).toBe('A')
    expect(graph.brokenLinks).toEqual([{ sessionId: 'B', missing: 'C' }])
  })

  it('solapamiento sin enlace: se informa y no se resta nada', () => {
    const graph = linkConversations([
      fp('A', ['u1', 'u2'], [ev('m1', 10)]),
      fp('B', ['u1', 'u2', 'u3'], [ev('m1', 10), ev('m2', 1)])
    ])
    expect(graph.unlinkedOverlaps).toEqual([{ a: 'A', b: 'B', lines: 2 }])
    expect(graph.links.get('B')?.ownUsage.output).toBe(11)
    expect(graph.links.get('B')?.inherited.size).toBe(0)
  })

  it('un ciclo de enlaces no cuelga el cálculo', () => {
    const graph = linkConversations([fp('A', [], [], 'B'), fp('B', [], [], 'A')])
    expect(graph.links.size).toBe(2)
  })

  it('applyLink sin enlace devuelve la sesión tal cual', async () => {
    const refs = await nubeRefs()
    const ref = refs.get(A)
    if (!ref) throw new Error('falta fixture')
    const loaded = await loadSession(ref)
    expect(applyLink(loaded, undefined)).toBe(loaded)
  })
})
