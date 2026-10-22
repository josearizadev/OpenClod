import { LIVE_LINE_START } from '../../../shared/chat'
import type { TranscriptItem } from '../../../shared/sessions'
import type { JsonlRecord } from '../jsonl-reader'
import { SessionAccumulator } from '../session-parser'

/**
 * Mensajes `assistant` y `user` del Agent SDK como líneas de disco. Tienen
 * la misma forma y el mismo `uuid` que las líneas que escribe Claude Code, así que se pasan por el
 * `SessionAccumulator` y los elementos en vivo son los mismos que se leerán de disco:
 * no se duplica la lógica de parseo. Uno para el hilo principal y uno por subagente.
 */

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export { LIVE_LINE_START }

/** Herramientas que lanzan subagentes. */
const AGENT_TOOLS = new Set(['Agent', 'Task'])

export interface SdkRecordsOutput {
  main: TranscriptItem[]
  subagents: { toolUseId: string; items: TranscriptItem[] }[]
}

interface AgentCall {
  /** `uuid` y línea del mensaje con el `tool_use`: los del `subagent-ref` de disco. */
  uuid?: string
  timestamp?: string
  line: number
  referenced: boolean
  /** De la entrada de la llamada: respaldo si el resultado no los trae. */
  agentType?: string
  description?: string
}

export class SdkRecords {
  private line = LIVE_LINE_START
  private readonly main = new SessionAccumulator({ keepItems: false })
  private readonly subs = new Map<string, SessionAccumulator>()
  private readonly agentCalls = new Map<string, AgentCall>()

  /** Línea para un elemento en vivo que no viene del SDK (prompt entregado, duración). */
  nextLine(): number {
    this.line += 1
    return this.line
  }

  /** Traduce un mensaje del SDK; lo que no es `assistant`/`user` no produce nada. */
  add(msg: unknown): SdkRecordsOutput {
    const out: SdkRecordsOutput = { main: [], subagents: [] }
    if (!isObj(msg)) return out
    const type = msg['type']
    if ((type !== 'assistant' && type !== 'user') || msg['isReplay'] === true) return out
    if (!isObj(msg['message'])) return out

    const parent = str(msg['parent_tool_use_id'])
    const record = this.toRecord(msg, parent)
    if (!parent) {
      this.main.add(record)
      out.main = this.main.drainItems()
      this.trackAgentCalls(out.main, record)
      const ref = this.refFromResult(msg)
      if (ref) out.main.push(ref)
      return out
    }

    let acc = this.subs.get(parent)
    if (!acc) {
      acc = new SessionAccumulator({ keepItems: false, ...this.agentIdOf(msg) })
      this.subs.set(parent, acc)
    }
    acc.add(record)
    out.subagents.push({ toolUseId: parent, items: acc.drainItems() })
    const ref = this.refFromSubagent(parent, msg)
    if (ref) out.main.push(ref)
    return out
  }

  /** La línea que escribiría Claude Code para este mensaje. */
  private toRecord(msg: Obj, parent: string | undefined): JsonlRecord {
    this.line += 1
    const value: Obj = {
      type: msg['type'],
      message: msg['message'],
      isSidechain: parent !== undefined,
      timestamp: str(msg['timestamp']) ?? new Date().toISOString()
    }
    const uuid = str(msg['uuid'])
    if (uuid) value['uuid'] = uuid
    if (msg['tool_use_result'] !== undefined) value['toolUseResult'] = msg['tool_use_result']
    if (msg['isSynthetic'] === true) value['isMeta'] = true
    return { line: this.line, value }
  }

  private agentIdOf(msg: Obj): { agentId?: string } {
    const agentId = str(msg['agent_id'])
    return agentId ? { agentId } : {}
  }

  private trackAgentCalls(items: TranscriptItem[], record: JsonlRecord): void {
    for (const item of items) {
      if (item.kind !== 'tool-use' || !AGENT_TOOLS.has(item.name) || !item.id) continue
      if (this.agentCalls.has(item.id)) continue
      const value = 'value' in record && isObj(record.value) ? record.value : {}
      const input = isObj(item.input) ? item.input : {}
      this.agentCalls.set(item.id, {
        line: record.line,
        referenced: false,
        ...(str(input['subagent_type']) ? { agentType: str(input['subagent_type']) } : {}),
        ...(str(input['description']) ? { description: str(input['description']) } : {}),
        ...(str(value['uuid']) ? { uuid: str(value['uuid']) } : {}),
        ...(str(value['timestamp']) ? { timestamp: str(value['timestamp']) } : {})
      })
    }
  }

  /**
   * `subagent-ref` como el que sale de disco tras el `tool_use` (allí se conoce por el `.meta.json`
   * del subagente). En vivo se sabe por el primer mensaje del subagente o por el resultado.
   */
  private ref(
    toolUseId: string,
    agentId: string | undefined,
    agentType: string | undefined,
    description: string | undefined
  ): TranscriptItem | null {
    const call = this.agentCalls.get(toolUseId)
    if (!call || call.referenced || !agentId) return null
    call.referenced = true
    agentType ??= call.agentType
    description ??= call.description
    return {
      line: call.line,
      ...(call.uuid ? { uuid: call.uuid } : {}),
      ...(call.timestamp ? { timestamp: call.timestamp } : {}),
      sidechain: false,
      kind: 'subagent-ref',
      toolUseId,
      agentId,
      ...(agentType ? { agentType } : {}),
      ...(description ? { description } : {})
    }
  }

  private refFromSubagent(parent: string, msg: Obj): TranscriptItem | null {
    return this.ref(
      parent,
      str(msg['agent_id']),
      str(msg['subagent_type']),
      str(msg['task_description'])
    )
  }

  private refFromResult(msg: Obj): TranscriptItem | null {
    const result = msg['tool_use_result']
    if (!isObj(result)) return null
    const message = msg['message'] as Obj
    const content = Array.isArray(message['content']) ? message['content'] : []
    for (const block of content) {
      if (!isObj(block) || block['type'] !== 'tool_result') continue
      const toolUseId = str(block['tool_use_id'])
      if (!toolUseId) continue
      const ref = this.ref(
        toolUseId,
        str(result['agentId']),
        str(result['agentType']) ?? str(result['subagent_type']),
        str(result['description'])
      )
      if (ref) return ref
    }
    return null
  }
}
