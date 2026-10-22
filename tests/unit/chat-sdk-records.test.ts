import { describe, expect, it } from 'vitest'
import { SdkMapper } from '../../src/main/services/chat/chat-mapper'
import { LIVE_LINE_START } from '../../src/main/services/chat/sdk-records'
import { sessionRefFromFile } from '../../src/main/services/claude-paths'
import { loadSession, loadSubagent } from '../../src/main/services/session-loader'
import type { TranscriptItem } from '../../src/shared/sessions'
import { CHAT_CASES, diskFile, sdkMessages, type ChatCase } from './chat-fixtures'

/** Lo que importa para comparar: sin línea ni hora (en vivo son propias). */
function comparable(item: TranscriptItem): Record<string, unknown> {
  const { line: _line, timestamp: _ts, ...rest } = item
  void _line
  void _ts
  return rest
}

function live(name: ChatCase): {
  main: TranscriptItem[]
  subagents: Map<string, TranscriptItem[]>
} {
  const mapper = new SdkMapper()
  const main: TranscriptItem[] = []
  const subagents = new Map<string, TranscriptItem[]>()
  for (const msg of sdkMessages(name)) {
    for (const event of mapper.map(msg)) {
      if (event.kind === 'items') main.push(...event.items)
      if (event.kind === 'subagent-items') {
        const list = subagents.get(event.toolUseId) ?? []
        list.push(...event.items)
        subagents.set(event.toolUseId, list)
      }
    }
  }
  return { main, subagents }
}

describe('sdk-records: los elementos en vivo son los de disco', () => {
  it.each(CHAT_CASES)('%s: cada elemento en vivo está igual en disco (por uuid)', async (name) => {
    const { main } = live(name)
    const disk = (await loadSession(await sessionRefFromFile(diskFile(name)))).items
    expect(main.length).toBeGreaterThan(0)
    for (const item of main) {
      expect(item.line).toBeGreaterThan(LIVE_LINE_START)
      expect(item.uuid).toBeTruthy()
      const same = disk.filter((d) => d.uuid === item.uuid && d.kind === item.kind)
      expect(same.map(comparable), `${item.kind} ${item.uuid}`).toContainEqual(comparable(item))
    }
  })

  it.each(CHAT_CASES)(
    '%s: lo que en disco viene del SDK (assistant, tool-result) también llega en vivo',
    async (name) => {
      const { main } = live(name)
      const disk = (await loadSession(await sessionRefFromFile(diskFile(name)))).items
      const liveIds = new Set(main.map((i) => `${i.uuid}:${i.kind}`))
      const fromSdk = disk.filter(
        (d) =>
          (d.kind === 'assistant-text' || d.kind === 'tool-use' || d.kind === 'tool-result') &&
          !d.sidechain
      )
      for (const item of fromSdk)
        expect(liveIds, `${item.kind} ${item.uuid}`).toContain(`${item.uuid}:${item.kind}`)
    }
  )

  it('tareas: el subagente llega en vivo con su subagent-ref y su transcript', async () => {
    const { main, subagents } = live('tareas')
    const ref = main.find((i) => i.kind === 'subagent-ref')
    expect(ref).toMatchObject({
      kind: 'subagent-ref',
      toolUseId: 'toolu_01RCFSes148E8JyCRjwuNpiB',
      agentId: 'a9d629e147f1c33e9'
    })
    const sessionRef = await sessionRefFromFile(diskFile('tareas'))
    const diskRef = (await loadSession(sessionRef)).items.find((i) => i.kind === 'subagent-ref')
    expect(ref?.uuid).toBe(diskRef?.uuid)

    const items = subagents.get('toolu_01RCFSes148E8JyCRjwuNpiB') ?? []
    expect(items.map((i) => i.kind)).toEqual(['tool-use', 'tool-result', 'assistant-text'])
    expect(items.every((i) => i.sidechain)).toBe(true)
    const diskSub = (await loadSubagent(sessionRef, 'a9d629e147f1c33e9')) ?? []
    for (const item of items) {
      const same = diskSub.find((d) => d.uuid === item.uuid && d.kind === item.kind)
      expect(same && comparable(same)).toEqual(comparable(item))
    }
  })

  it('interrupción: el aviso «Request interrupted» llega como interrupted', () => {
    const { main } = live('interrupcion')
    expect(main.filter((i) => i.kind === 'interrupted')).toHaveLength(1)
  })
})
