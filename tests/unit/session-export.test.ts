import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sessionRefFromFile } from '../../src/main/services/claude-paths'
import { loadSession } from '../../src/main/services/session-loader'
import {
  exportFileName,
  fence,
  toMarkdown,
  toolSummary
} from '../../src/main/services/session-export'
import type { SessionDetail } from '../../src/shared/projects'
import type { TranscriptItem, TranscriptPayload } from '../../src/shared/sessions'

const NOW = new Date('2026-10-19T10:00:00Z')
const TZ = 'Europe/Madrid'

function item(
  line: number,
  rest: Partial<TranscriptItem> & { kind: TranscriptItem['kind'] }
): TranscriptItem {
  return { line, sidechain: false, timestamp: '2026-10-14T08:00:00Z', ...rest } as TranscriptItem
}

const detail = {
  sessionId: 's2',
  title: 'Arreglar: el login / 2ª parte',
  startedAt: '2026-10-14T08:00:00Z',
  updatedAt: '2026-10-14T09:30:00Z',
  gitBranch: 'main',
  usage: { input: 10, output: 20, cacheCreation: 30, cacheRead: 40 },
  chainLength: 2,
  favorite: false,
  hidden: false,
  titleSource: 'app',
  models: ['claude-opus-5-5'],
  messageCount: 3,
  toolCallCount: 1,
  subagentCount: 0,
  ownUsage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  cwd: 'C:\\repo',
  chain: ['s1', 's2']
} satisfies SessionDetail

const payload: TranscriptPayload = {
  sessionId: 's2',
  cwd: 'C:\\repo',
  invalidLines: 0,
  subagents: [],
  segments: [
    { sessionId: 's1', firstLine: 1 },
    { sessionId: 's2', firstLine: 5, startedAt: '2026-10-14T09:00:00Z' }
  ],
  items: [
    item(1, { kind: 'user-prompt', text: 'Arregla el login', images: 1, inherited: true }),
    item(2, { kind: 'thinking', text: 'PENSANDO EN SECRETO', inherited: true }),
    item(3, {
      kind: 'tool-use',
      id: 't1',
      name: 'Edit',
      input: { file_path: 'C:\\repo\\src\\login.ts', old_string: 'a', new_string: 'b' },
      inherited: true
    }),
    item(4, {
      kind: 'tool-result',
      toolUseId: 't1',
      isError: false,
      text: 'ok ```',
      inherited: true
    }),
    item(5, { kind: 'command', name: '/review', args: '' }),
    item(6, { kind: 'meta', text: 'aviso interno' }),
    item(7, { kind: 'assistant-text', text: 'Listo.' }),
    item(8, { kind: 'assistant-text', text: 'Algo más.', sidechain: true })
  ]
}

describe('toMarkdown', () => {
  it('cabecera, turnos, herramientas en una línea y continuación; sin thinking ni internos', () => {
    const md = toMarkdown(payload, detail, { tools: false, now: NOW, timeZone: TZ })
    expect(md).toContain('# Arreglar: el login / 2ª parte')
    expect(md).toContain('- **Carpeta:** `C:\\repo`')
    expect(md).toContain('- **Rama:** `main`')
    expect(md).toContain('- **Tokens:** 100')
    expect(md).toContain('### Tú · 10:00\n\nArregla el login\n\n_(1 imagen)_')
    expect(md).toContain('> 🔧 `Edit` · src/login.ts')
    expect(md).toContain('_Continuación · 14 oct 2026, 11:00_')
    expect(md).toContain('`/review`')
    expect(md).toContain('### Claude · 10:00\n\nListo.')
    expect(md).not.toContain('PENSANDO')
    expect(md).not.toContain('aviso interno')
    expect(md).not.toContain('Algo más')
    expect(md).not.toContain('"old_string"')
  })

  it('con detalles: entrada y resultado con vallas que no se rompen', () => {
    const md = toMarkdown(payload, detail, { tools: true, now: NOW, timeZone: TZ })
    expect(md).toContain('"old_string": "a"')
    expect(md).toContain('**Resultado:**\n\n````\nok ```\n````')
  })

  it('con una sesión real de los fixtures', async () => {
    const file = join(
      __dirname,
      '../fixtures/claude/projects/Z--web-Nube/07319c10-f4d8-43f5-b876-ec4c89ae65d4.jsonl'
    )
    const loaded = await loadSession(await sessionRefFromFile(file))
    const md = toMarkdown(
      {
        sessionId: loaded.summary.sessionId,
        items: loaded.items,
        segments: [],
        subagents: [],
        invalidLines: 0
      },
      null,
      { tools: false, now: NOW, timeZone: TZ }
    )
    expect(md.startsWith('# Sesión de Claude Code\n')).toBe(true)
    expect(md).toContain('### Tú')
    expect(md).toContain('### Claude')
    expect(md).not.toMatch(/\n{3,}/)
  })
})

describe('utilidades', () => {
  it('fence alarga la valla', () => {
    expect(fence('a ``` b', 'js')).toBe('````js\na ``` b\n````')
    expect(fence('x')).toBe('```\nx\n```')
  })

  it('toolSummary', () => {
    expect(toolSummary('Bash', { command: 'npm test\nmás' })).toBe('`Bash` · npm test')
    expect(toolSummary('Grep', { pattern: 'a`b' })).toBe("`Grep` · a'b")
    expect(toolSummary('Raro', 42)).toBe('`Raro`')
  })

  it('exportFileName', () => {
    expect(exportFileName('Arreglar: el login / 2ª parte')).toBe('Arreglar el login 2ª parte.md')
    expect(exportFileName('  ...  ')).toBe('sesion.md')
  })
})
