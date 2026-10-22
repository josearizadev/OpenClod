import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listProjects, type SessionFileRef } from '../../src/main/services/claude-paths'
import { loadSession } from '../../src/main/services/session-loader'
import type { TokenUsage } from '../../src/shared/sessions'

const FIXTURES = join(__dirname, '../fixtures/claude')

/**
 * Totales obtenidos con el recuento independiente en Python:
 *   python scripts/recuento-tokens.py tests/fixtures/claude/projects
 * (principal + subagentes, deduplicado por message.id:requestId con máximo por campo).
 */
const RECUENTO: Record<string, TokenUsage> = {
  'C--Programas/3f010094-259d-4b05-80f2-637772220194': {
    input: 74,
    output: 20665,
    cacheCreation: 100750,
    cacheRead: 2098802
  },
  'Z--demo/00000000-0000-4000-8000-000000000001': {
    input: 10,
    output: 42,
    cacheCreation: 100,
    cacheRead: 1000
  },
  'Z--web-Nube/07319c10-f4d8-43f5-b876-ec4c89ae65d4': {
    input: 6,
    output: 436,
    cacheCreation: 56372,
    cacheRead: 116402
  },
  'Z--web-Nube/0e56deca-67ad-4d7c-bc94-a61cc14540cd': {
    input: 336,
    output: 211253,
    cacheCreation: 457857,
    cacheRead: 43933786
  },
  'Z--web-Nube/9c81d504-7ee7-4a60-a274-500078e29ce3': {
    input: 44,
    output: 73604,
    cacheCreation: 153921,
    cacheRead: 1184654
  },
  'Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423': {
    input: 70,
    output: 95116,
    cacheCreation: 217993,
    cacheRead: 1468056
  }
}

async function refs(): Promise<Map<string, SessionFileRef>> {
  const result = await listProjects(FIXTURES)
  if (!result.ok) throw new Error(result.reason)
  return new Map(
    result.projects.flatMap((p) => p.sessions.map((s) => [`${p.name}/${s.sessionId}`, s] as const))
  )
}

describe('loadSession', async () => {
  const all = await refs()

  function ref(key: string): SessionFileRef {
    const found = all.get(key)
    if (!found) throw new Error(`Falta el fixture ${key}`)
    return found
  }

  it.each(Object.entries(RECUENTO))(
    'los tokens de %s coinciden con el recuento independiente',
    async (key, expected) => {
      const { summary } = await loadSession(ref(key))
      expect(summary.usage).toEqual(expected)
    }
  )

  it('enlaza cada tool_use Agent con su subagente y resume los subagentes', async () => {
    const loaded = await loadSession(ref('Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423'))
    expect(loaded.summary.subagents.map((s) => [s.agentId, s.agentType])).toEqual([
      ['a3aa898a77e40ab58', 'Explore'],
      ['a8bf231e68420c4fd', 'Explore'],
      ['a8ec5f2f2b4b0845b', 'Plan']
    ])
    for (const sub of loaded.summary.subagents) {
      expect(sub.toolUseId).toMatch(/^toolu_/)
      expect(sub.description).toBeTruthy()
      expect(sub.messageCount).toBeGreaterThan(0)
      expect(loaded.subagentItems.get(sub.agentId)?.length).toBeGreaterThan(0)
    }
    const refsInMain = loaded.items.filter((i) => i.kind === 'subagent-ref')
    expect(refsInMain.map((i) => (i.kind === 'subagent-ref' ? i.agentId : ''))).toEqual(
      expect.arrayContaining(['a3aa898a77e40ab58', 'a8bf231e68420c4fd'])
    )
    for (const item of refsInMain) {
      const use = loaded.items.find(
        (i) =>
          i.kind === 'tool-use' && i.id === (item.kind === 'subagent-ref' ? item.toolUseId : '')
      )
      expect(use).toMatchObject({ name: 'Agent' })
    }
  })

  it('el uso de la sesión incluye el de sus subagentes', async () => {
    const loaded = await loadSession(ref('Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423'))
    expect(loaded.usage.some((e) => e.agentId)).toBe(true)
    expect(loaded.usage.some((e) => !e.agentId)).toBe(true)
    expect(new Set(loaded.usage.map((e) => e.key)).size).toBe(loaded.usage.length)
  })

  it('resume la sesión: título, vista previa, continuación y diagnóstico', async () => {
    const { summary, diagnostics } = await loadSession(
      ref('Z--web-Nube/9c81d504-7ee7-4a60-a274-500078e29ce3')
    )
    expect(summary).toMatchObject({
      sessionId: '9c81d504-7ee7-4a60-a274-500078e29ce3',
      cwd: 'Z:\\web\\Nube',
      title: 'ut enim labore do sit',
      titleSource: 'agent-name',
      gitBranch: 'main',
      models: ['claude-sonnet-5']
    })
    expect(summary.preview).toBeTruthy()
    expect(diagnostics.invalidCount).toBe(0)
    expect(diagnostics.lines).toBeGreaterThan(79)
  })

  it('a55accdd indica en qué sesión continúa', async () => {
    const { summary } = await loadSession(ref('Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423'))
    expect(summary.continuedIn).toBe('9c81d504-7ee7-4a60-a274-500078e29ce3')
    expect(summary.titleSource).toBe('ai-title')
  })

  it('el título propio de la app gana a todo', async () => {
    const { summary } = await loadSession(ref('Z--web-Nube/0e56deca-67ad-4d7c-bc94-a61cc14540cd'), {
      appTitle: 'Mi título'
    })
    expect(summary).toMatchObject({ title: 'Mi título', titleSource: 'app' })
  })

  it('un subagente con .meta.json ilegible o ausente se carga sin metadatos', async () => {
    const base = ref('Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423')
    const broken: SessionFileRef = {
      ...base,
      subagents: base.subagents.map((s) => ({
        agentId: s.agentId,
        file: s.file,
        metaFile: base.file
      }))
    }
    const { summary } = await loadSession(broken)
    expect(summary.subagents.every((s) => !s.agentType && !s.toolUseId)).toBe(true)
    expect(summary.usage).toEqual(RECUENTO['Z--web-Nube/a55accdd-171f-4711-936e-b51294a4b423'])
  })
})
