import { z } from 'zod'
import {
  LIMIT_KINDS,
  LIMIT_STATUSES,
  type CostPoint,
  type LimitHit,
  type SessionDiagnostics,
  type TitleSource,
  type TranscriptItem,
  type UsageEvent
} from '../../shared/sessions'
import type { JsonlRecord } from './jsonl-reader'
import { readUsage, SYNTHETIC_MODEL, UsageLedger, usageKey } from './usage'

/**
 * Parser de sesiones de Claude Code. Puro y tolerante: recibe registros
 * ya leídos (`readJsonl`), nunca lanza y convierte lo que no reconoce en `unknown` contándolo en
 * el diagnóstico. Es incremental: `add()` se puede llamar en varias tandas, y entre
 * pasadas del índice se guarda y se recupera con `snapshot()` / `restore()`.
 */

/**
 * Versión del estado guardado de los acumuladores. Subirla cuando cambie lo que el parser extrae
 * o la forma del snapshot: el índice se vacía y se relee todo.
 */
export const PARSER_VERSION = 5

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Líneas de estado que se reconocen pero no generan elementos ni datos del resumen. */
const IGNORED_LINE_TYPES = new Set([
  'mode',
  'permission-mode',
  'atis-latch',
  'file-history-snapshot',
  'file-history-delta',
  'queue-operation',
  'bridge-session',
  // CLI 2.1.30x (visto el 2026-10-19): metadatos de cada petición a la API. Pueden llevar el
  // contenido de la petición: no se leen.
  'api-request',
  'api-request-blob',
  'api-request-shape'
])

const MAX_INVALID_LINES = 50
/** Tope de avisos de límite por archivo: un bucle de reintentos no debe inflar el snapshot. */
const MAX_LIMIT_HITS = 200
const KNOWN_LIMIT_KINDS = new Set<string>(LIMIT_KINDS)
const KNOWN_LIMIT_STATUSES = new Set<string>(LIMIT_STATUSES)
const TITLE_MAX = 80
const PREVIEW_MAX = 160

export interface SubagentMeta {
  agentId: string
  agentType?: string
  description?: string
}

export interface AccumulatorOptions {
  /** El archivo es el transcript de este subagente. */
  agentId?: string
  /** Subagentes de la sesión por el `id` del `tool_use` que los lanzó (genera `subagent-ref`). */
  subagentsByToolUse?: ReadonlyMap<string, SubagentMeta>
  /**
   * Conservar los elementos del transcript (por defecto `true`). Con `false` solo se guardan hasta
   * la siguiente llamada a `drainItems()`: el índice saca de ellos los `uuid` sin guardar el texto.
   */
  keepItems?: boolean
}

export interface SessionStats {
  sessionId?: string
  /** Primer `cwd` visto: el proyecto al que pertenece la sesión. */
  startCwd?: string
  /** Último `cwd` visto. */
  cwd?: string
  gitBranch?: string
  startedAt?: string
  updatedAt?: string
  models: string[]
  cliVersions: string[]
  messageCount: number
  /** Prompts reales del usuario: las sesiones sin ninguno se ocultan de la lista. */
  promptCount: number
  toolCallCount: number
  agentName?: string
  aiTitle?: string
  firstPrompt?: string
  /** Primer comando (`/nombre args`): título de respaldo de las sesiones sin prompts. */
  firstCommand?: string
  lastPrompt?: string
  continuedIn?: string
  diagnostics: SessionDiagnostics
}

type UserTextItem = Extract<
  TranscriptItem,
  {
    kind:
      'user-prompt' | 'command' | 'command-output' | 'task-notification' | 'interrupted' | 'meta'
  }
>
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type UserTextKind = DistributiveOmit<UserTextItem, 'line' | 'uuid' | 'timestamp' | 'sidechain'>

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const COMMAND_OUTPUT = /^<local-command-(stdout|stderr)>([\s\S]*?)(?:<\/local-command-\1>)?\s*$/

/** Distingue los prompts reales de los demás mensajes de usuario. */
export function classifyUserText(text: string, isMeta = false): UserTextKind {
  const start = text.trimStart()
  if (
    isMeta ||
    start.startsWith('<local-command-caveat>') ||
    start.startsWith('<system-reminder>')
  ) {
    return { kind: 'meta', text }
  }
  const name = COMMAND_NAME.exec(text)
  if (name) {
    return {
      kind: 'command',
      name: (name[1] ?? '').trim(),
      args: (COMMAND_ARGS.exec(text)?.[1] ?? '').trim()
    }
  }
  const output = COMMAND_OUTPUT.exec(start)
  if (output) {
    return {
      kind: 'command-output',
      stream: output[1] === 'stderr' ? 'stderr' : 'stdout',
      text: (output[2] ?? '').trim()
    }
  }
  if (start.startsWith('<task-notification>')) return { kind: 'task-notification', text }
  if (start.startsWith('[Request interrupted by user')) return { kind: 'interrupted', text: start }
  return { kind: 'user-prompt', text, images: 0 }
}

/** Una línea, espacios colapsados y recortada a `max` caracteres con `…`. */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const UNTITLED = '(sin título)'

/** Título de la sesión por orden de preferencia. */
export function resolveTitle(sources: {
  appTitle?: string
  agentName?: string
  aiTitle?: string
  firstPrompt?: string
  firstCommand?: string
}): { title: string; source: TitleSource } {
  const order: [TitleSource, string | undefined][] = [
    ['app', sources.appTitle],
    ['agent-name', sources.agentName],
    ['ai-title', sources.aiTitle],
    ['prompt', sources.firstPrompt],
    ['command', sources.firstCommand]
  ]
  for (const [source, value] of order) {
    const title = value ? oneLine(value, TITLE_MAX) : ''
    if (title) return { title, source }
  }
  return { title: UNTITLED, source: 'none' }
}

/** Vista previa a partir del último prompt. */
export function previewOf(lastPrompt: string | undefined): string | undefined {
  const preview = lastPrompt ? oneLine(lastPrompt, PREVIEW_MAX) : ''
  return preview || undefined
}

/** Texto de un `tool_result`: cadena o bloques `text`; las imágenes se marcan como `[imagen]`. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!isObj(block)) return ''
      if (block['type'] === 'text') return str(block['text']) ?? ''
      if (block['type'] === 'image') return '[imagen]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

const TimeSchema = z.object({ ms: z.number(), iso: z.string() })
const CountsSchema = z.record(z.string(), z.number())
const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheCreation: z.number(),
  cacheRead: z.number()
})

/** Estado de un acumulador en JSON plano: todo lo que influye en `stats()` y `usage`. */
const AccumulatorSnapshotSchema = z.object({
  v: z.literal(PARSER_VERSION),
  info: z.object({
    sessionId: z.string().optional(),
    startCwd: z.string().optional(),
    cwd: z.string().optional(),
    gitBranch: z.string().optional(),
    agentName: z.string().optional(),
    aiTitle: z.string().optional(),
    firstPrompt: z.string().optional(),
    firstCommand: z.string().optional(),
    lastPrompt: z.string().optional(),
    continuedIn: z.string().optional()
  }),
  prompts: z.number(),
  lastUserPrompt: z.string().optional(),
  pendingCommand: z.string().optional(),
  firstTime: TimeSchema.optional(),
  lastTime: TimeSchema.optional(),
  models: z.array(z.string()),
  versions: z.array(z.string()),
  textMessages: z.array(z.string()),
  toolUses: z.array(z.string()),
  usage: z.array(
    z.object({
      key: z.string(),
      model: z.string(),
      timestamp: z.string().optional(),
      usage: TokenUsageSchema,
      agentId: z.string().optional()
    })
  ),
  limitHits: z.array(
    z.object({
      line: z.number(),
      timestamp: z.string(),
      kind: z.string(),
      status: z.string(),
      resetsAt: z.string().optional()
    })
  ),
  costPoints: z.array(
    z.object({
      startTime: z.number(),
      totalUsd: z.number(),
      timestamp: z.string().optional(),
      unknownModel: z.boolean()
    })
  ),
  lastLineTime: z.string().optional(),
  diag: z.object({
    lines: z.number(),
    invalidCount: z.number(),
    invalidLines: z.array(z.number()),
    unknownLineTypes: CountsSchema,
    unknownBlockTypes: CountsSchema
  })
})

export type AccumulatorSnapshot = z.infer<typeof AccumulatorSnapshotSchema>

export class SessionAccumulator {
  readonly items: TranscriptItem[] = []
  /** Elementos de `items` ya devueltos por `drainItems()`. */
  private drained = 0

  private readonly options: AccumulatorOptions
  private readonly usageLedger = new UsageLedger()
  private readonly models = new Set<string>()
  private readonly versions = new Set<string>()
  private readonly textMessages = new Set<string>()
  private readonly toolUses = new Set<string>()
  private prompts = 0
  /** Último prompt real: respaldo de la vista previa si no hay línea `last-prompt`. */
  private lastUserPrompt?: string
  /** Último comando antes de la primera respuesta del asistente: candidato a `firstCommand`. */
  private pendingCommand?: string
  private firstTime?: { ms: number; iso: string }
  private lastTime?: { ms: number; iso: string }
  /** Fecha de la última línea leída que la tenía (en orden del archivo, no la mayor). */
  private lastLineTime?: string
  private limitHitList: LimitHit[] = []
  private costPointList: CostPoint[] = []
  /** Último total visto de cada proceso: solo se guarda un punto cuando cambia. */
  private readonly lastCost = new Map<number, number>()
  private info: Omit<
    SessionStats,
    | 'models'
    | 'cliVersions'
    | 'messageCount'
    | 'promptCount'
    | 'toolCallCount'
    | 'diagnostics'
    | 'startedAt'
    | 'updatedAt'
  > = {}
  private diag = {
    lines: 0,
    invalidCount: 0,
    invalidLines: [] as number[],
    unknownLineTypes: {} as Record<string, number>,
    unknownBlockTypes: {} as Record<string, number>
  }

  constructor(options: AccumulatorOptions = {}) {
    this.options = options
  }

  /**
   * Recupera un acumulador guardado con `snapshot()`. Si es de otra versión del parser o no tiene
   * la forma esperada devuelve `null` (el archivo se relee entero); nunca lanza.
   */
  static restore(snapshot: unknown, options: AccumulatorOptions = {}): SessionAccumulator | null {
    const parsed = AccumulatorSnapshotSchema.safeParse(snapshot)
    if (!parsed.success) return null
    const data = parsed.data
    const acc = new SessionAccumulator(options)
    acc.info = { ...data.info }
    acc.prompts = data.prompts
    if (data.lastUserPrompt !== undefined) acc.lastUserPrompt = data.lastUserPrompt
    if (data.pendingCommand !== undefined) acc.pendingCommand = data.pendingCommand
    if (data.firstTime) acc.firstTime = data.firstTime
    if (data.lastTime) acc.lastTime = data.lastTime
    for (const model of data.models) acc.models.add(model)
    for (const version of data.versions) acc.versions.add(version)
    for (const id of data.textMessages) acc.textMessages.add(id)
    for (const id of data.toolUses) acc.toolUses.add(id)
    acc.usageLedger.add(data.usage)
    acc.limitHitList = data.limitHits.map((hit) => ({ ...hit }) as LimitHit)
    acc.costPointList = data.costPoints.map((point) => ({ ...point }))
    for (const point of acc.costPointList) acc.lastCost.set(point.startTime, point.totalUsd)
    if (data.lastLineTime !== undefined) acc.lastLineTime = data.lastLineTime
    acc.diag = {
      ...data.diag,
      invalidLines: [...data.diag.invalidLines],
      unknownLineTypes: { ...data.diag.unknownLineTypes },
      unknownBlockTypes: { ...data.diag.unknownBlockTypes }
    }
    return acc
  }

  /** Estado actual en JSON plano (sin los elementos del transcript), para `restore()`. */
  snapshot(): AccumulatorSnapshot {
    return {
      v: PARSER_VERSION,
      info: { ...this.info },
      prompts: this.prompts,
      ...(this.lastUserPrompt !== undefined ? { lastUserPrompt: this.lastUserPrompt } : {}),
      ...(this.pendingCommand !== undefined ? { pendingCommand: this.pendingCommand } : {}),
      ...(this.firstTime ? { firstTime: { ...this.firstTime } } : {}),
      ...(this.lastTime ? { lastTime: { ...this.lastTime } } : {}),
      models: [...this.models],
      versions: [...this.versions],
      textMessages: [...this.textMessages],
      toolUses: [...this.toolUses],
      usage: this.usageLedger.values(),
      limitHits: this.limitHitList.map((hit) => ({ ...hit })),
      costPoints: this.costPointList.map((point) => ({ ...point })),
      ...(this.lastLineTime !== undefined ? { lastLineTime: this.lastLineTime } : {}),
      diag: {
        ...this.diag,
        invalidLines: [...this.diag.invalidLines],
        unknownLineTypes: { ...this.diag.unknownLineTypes },
        unknownBlockTypes: { ...this.diag.unknownBlockTypes }
      }
    }
  }

  /**
   * Elementos añadidos desde la última llamada. Con `keepItems: false` además se sueltan, así el
   * acumulador no guarda el transcript entero.
   */
  drainItems(): TranscriptItem[] {
    const out = this.items.slice(this.drained)
    if (this.options.keepItems === false) {
      this.items.length = 0
      this.drained = 0
    } else {
      this.drained = this.items.length
    }
    return out
  }

  /** Eventos de uso de la sesión, ya fusionados por clave. */
  get usage(): UsageEvent[] {
    return this.usageLedger.values()
  }

  /** Avisos de límite alcanzado del archivo, en orden. */
  get limitHits(): LimitHit[] {
    return this.limitHitList.map((hit) => ({ ...hit }))
  }

  /** Puntos de coste acumulado de `cost-state`, solo cuando cambia el total. */
  get costPoints(): CostPoint[] {
    return this.costPointList.map((point) => ({ ...point }))
  }

  addAll(records: Iterable<JsonlRecord>): this {
    for (const record of records) this.add(record)
    return this
  }

  /** Añade una tanda de `readJsonl`; así también cuentan las líneas vacías del final. */
  addChunk(chunk: { records: Iterable<JsonlRecord>; line: number }): this {
    this.addAll(chunk.records)
    this.diag.lines = Math.max(this.diag.lines, chunk.line)
    return this
  }

  add(record: JsonlRecord): void {
    this.diag.lines = Math.max(this.diag.lines, record.line)
    if ('error' in record) {
      this.diag.invalidCount += 1
      if (this.diag.invalidLines.length < MAX_INVALID_LINES)
        this.diag.invalidLines.push(record.line)
      return
    }
    const value = record.value
    if (!isObj(value)) {
      this.unknownLine(record.line, '(sin tipo)', 'la línea no es un objeto')
      return
    }
    this.trackCommon(value)
    const type = str(value['type'])
    switch (type) {
      case 'user':
        this.addUser(record.line, value)
        return
      case 'assistant':
        this.addAssistant(record.line, value)
        return
      case 'system':
        this.push(record.line, value, {
          kind: 'system',
          subtype: str(value['subtype']) ?? '(sin subtipo)',
          ...(typeof value['content'] === 'string' ? { text: value['content'] } : {}),
          ...(typeof value['durationMs'] === 'number' ? { durationMs: value['durationMs'] } : {})
        })
        return
      case 'attachment': {
        const attachment = value['attachment']
        if (isObj(attachment) && attachment['type'] === 'queued_command') {
          if (this.addQueuedCommand(record.line, value, attachment)) return
        }
        const attachmentType = (isObj(attachment) && str(attachment['type'])) || '(sin tipo)'
        this.push(record.line, value, { kind: 'attachment', attachmentType })
        return
      }
      case 'ai-title':
        this.info.aiTitle = str(value['aiTitle']) ?? this.info.aiTitle
        return
      case 'agent-name':
        this.info.agentName = str(value['agentName']) ?? this.info.agentName
        return
      case 'last-prompt':
        this.info.lastPrompt = str(value['lastPrompt']) ?? this.info.lastPrompt
        return
      case 'continued-in':
        this.info.continuedIn = str(value['continuedInSessionId']) ?? this.info.continuedIn
        return
      case 'cost-state':
        this.addCostState(value)
        return
      default:
        if (type && IGNORED_LINE_TYPES.has(type)) return
        this.unknownLine(record.line, type ?? '(sin tipo)', 'tipo de línea desconocido', value)
    }
  }

  stats(): SessionStats {
    const lastPrompt = this.info.lastPrompt ?? this.lastUserPrompt
    const firstCommand = this.info.firstCommand ?? this.pendingCommand
    return {
      ...this.info,
      ...(lastPrompt !== undefined ? { lastPrompt } : {}),
      ...(firstCommand !== undefined ? { firstCommand } : {}),
      ...(this.firstTime ? { startedAt: this.firstTime.iso } : {}),
      ...(this.lastTime ? { updatedAt: this.lastTime.iso } : {}),
      models: [...this.models],
      cliVersions: [...this.versions].sort(compareVersions),
      messageCount: this.prompts + this.textMessages.size,
      promptCount: this.prompts,
      toolCallCount: this.toolUses.size,
      diagnostics: {
        lines: this.diag.lines,
        invalidCount: this.diag.invalidCount,
        invalidLines: [...this.diag.invalidLines],
        unknownLineTypes: { ...this.diag.unknownLineTypes },
        unknownBlockTypes: { ...this.diag.unknownBlockTypes },
        cliVersions: [...this.versions].sort(compareVersions)
      }
    }
  }

  private trackCommon(value: Obj): void {
    const sessionId = str(value['sessionId'])
    if (sessionId && !this.info.sessionId) this.info.sessionId = sessionId
    const cwd = str(value['cwd'])
    if (cwd) {
      this.info.startCwd ??= cwd
      this.info.cwd = cwd
    }
    const branch = str(value['gitBranch'])
    if (branch) this.info.gitBranch = branch
    const version = str(value['version'])
    if (version) this.versions.add(version)
    const timestamp = str(value['timestamp'])
    const ms = timestamp ? Date.parse(timestamp) : NaN
    if (timestamp && Number.isFinite(ms)) {
      this.lastLineTime = timestamp
      if (!this.firstTime || ms < this.firstTime.ms) this.firstTime = { ms, iso: timestamp }
      if (!this.lastTime || ms > this.lastTime.ms) this.lastTime = { ms, iso: timestamp }
    }
  }

  private push(
    line: number,
    value: Obj,
    item: DistributiveOmit<TranscriptItem, 'line' | 'uuid' | 'timestamp' | 'sidechain'>
  ): void {
    const uuid = str(value['uuid'])
    const timestamp = str(value['timestamp'])
    this.items.push({
      line,
      ...(uuid ? { uuid } : {}),
      ...(timestamp ? { timestamp } : {}),
      sidechain: value['isSidechain'] === true,
      ...item
    } as TranscriptItem)
  }

  private unknownLine(line: number, type: string, reason: string, value: Obj = {}): void {
    bump(this.diag.unknownLineTypes, type)
    this.push(line, value, { kind: 'unknown', originalType: type, reason })
  }

  private unknownBlock(line: number, value: Obj, type: string, reason: string): void {
    bump(this.diag.unknownBlockTypes, type)
    this.push(line, value, { kind: 'unknown', originalType: type, reason })
  }

  private countsAsPrompt(value: Obj): boolean {
    // En el transcript de un subagente todo es sidechain y su primer mensaje es el encargo.
    return value['isSidechain'] !== true || this.options.agentId !== undefined
  }

  private addUserText(line: number, value: Obj, text: string, images: number): void {
    const item = classifyUserText(text, value['isMeta'] === true)
    if (item.kind === 'user-prompt') {
      item.images = images
      if (this.countsAsPrompt(value)) {
        this.prompts += 1
        if (this.info.firstPrompt === undefined && text.trim()) this.info.firstPrompt = text
        if (text.trim()) this.lastUserPrompt = text
      }
    } else if (
      item.kind === 'command' &&
      item.name &&
      this.info.firstCommand === undefined &&
      this.countsAsPrompt(value)
    ) {
      // Se fija con la primera respuesta: así un `/clear` previo no se queda como título.
      this.pendingCommand = item.args ? `${item.name} ${item.args}` : item.name
    }
    this.push(line, value, item)
  }

  /**
   * Mensaje que Claude recibió a mitad de turno: un prompt del usuario o una
   * notificación de tarea. Es contenido del usuario, no de un adjunto, así que sí sale del parser.
   * Devuelve `false` si no trae texto (se queda como `attachment`).
   */
  private addQueuedCommand(line: number, value: Obj, attachment: Obj): boolean {
    const prompt = attachment['prompt']
    let text: string
    let images = 0
    if (typeof prompt === 'string') text = prompt
    else if (Array.isArray(prompt)) {
      const texts: string[] = []
      for (const block of prompt) {
        if (!isObj(block)) continue
        if (block['type'] === 'text') texts.push(str(block['text']) ?? '')
        else if (block['type'] === 'image') images += 1
      }
      text = texts.join('\n\n')
    } else return false
    if (!text.trim() && images === 0) return false
    if (attachment['commandMode'] === 'task-notification') {
      this.push(line, value, { kind: 'task-notification', text })
      return true
    }
    const sourceUuid = str(attachment['source_uuid'])
    if (this.countsAsPrompt(value)) {
      this.prompts += 1
      if (this.info.firstPrompt === undefined && text.trim()) this.info.firstPrompt = text
      if (text.trim()) this.lastUserPrompt = text
    }
    this.push(line, value, {
      kind: 'user-prompt',
      text,
      images,
      queued: true,
      ...(sourceUuid ? { sourceUuid } : {})
    })
    return true
  }

  private addUser(line: number, value: Obj): void {
    const message = value['message']
    const content = isObj(message) ? message['content'] : undefined
    if (typeof content === 'string') {
      this.addUserText(line, value, content, 0)
      return
    }
    if (!Array.isArray(content)) {
      this.unknownBlock(
        line,
        value,
        '(contenido no reconocido)',
        'contenido de usuario no reconocido'
      )
      return
    }
    const texts: string[] = []
    let images = 0
    for (const block of content) {
      const type = isObj(block) ? str(block['type']) : undefined
      if (!isObj(block) || !type) {
        this.unknownBlock(line, value, '(sin tipo)', 'bloque sin tipo')
      } else if (type === 'text') {
        texts.push(str(block['text']) ?? '')
      } else if (type === 'image') {
        images += 1
      } else if (type === 'tool_result') {
        this.push(line, value, {
          kind: 'tool-result',
          toolUseId: str(block['tool_use_id']) ?? '',
          isError: block['is_error'] === true,
          text: toolResultText(block['content'])
        })
      } else {
        this.unknownBlock(line, value, type, 'bloque de usuario desconocido')
      }
    }
    if (texts.length > 0 || images > 0) this.addUserText(line, value, texts.join('\n\n'), images)
  }

  /**
   * `cost-state`: total acumulado del proceso. Se guarda un punto por cada
   * total nuevo de cada `startTime`; los incrementos se calculan al consultar, entre todos los
   * archivos, porque una continuación arrastra el total del proceso de la sesión anterior.
   */
  private addCostState(value: Obj): void {
    const startTime = value['startTime']
    const total = value['totalCostUSD']
    if (typeof startTime !== 'number' || !Number.isFinite(startTime)) return
    if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return
    if (this.lastCost.get(startTime) === total) return
    this.lastCost.set(startTime, total)
    this.costPointList.push({
      startTime,
      totalUsd: total,
      ...(this.lastLineTime !== undefined ? { timestamp: this.lastLineTime } : {}),
      unknownModel: value['hasUnknownModelCost'] === true
    })
  }

  /**
   * Aviso de límite: mensaje `<synthetic>` con `error: "rate_limit"`. Solo se
   * copian estado, ventana y renovación de `quotaLimits` o `apiErrorParams.rate_limit_info`;
   * el texto («resets 9:30pm») no se interpreta. Los subagentes no cuentan: el aviso llega también
   * a la sesión principal.
   */
  private addLimitHit(line: number, value: Obj, model: string | undefined): void {
    if (model !== SYNTHETIC_MODEL || value['error'] !== 'rate_limit') return
    if (this.options.agentId !== undefined || this.limitHitList.length >= MAX_LIMIT_HITS) return
    const timestamp = str(value['timestamp'])
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return
    const params = value['apiErrorParams']
    const info = isObj(value['quotaLimits'])
      ? value['quotaLimits']
      : isObj(params) && isObj(params['rate_limit_info'])
        ? params['rate_limit_info']
        : {}
    const kind = str(info['rateLimitType'])
    const status = str(info['status'])
    const resetsAt = info['resetsAt']
    const resetsMs =
      typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0
        ? resetsAt * 1000
        : NaN
    this.limitHitList.push({
      line,
      timestamp,
      kind: kind && KNOWN_LIMIT_KINDS.has(kind) ? (kind as LimitHit['kind']) : 'unknown',
      status:
        status && KNOWN_LIMIT_STATUSES.has(status) ? (status as LimitHit['status']) : 'unknown',
      ...(Number.isFinite(resetsMs) ? { resetsAt: new Date(resetsMs).toISOString() } : {})
    })
  }

  private addAssistant(line: number, value: Obj): void {
    const message = value['message']
    this.addLimitHit(line, value, isObj(message) ? str(message['model']) : undefined)
    if (!isObj(message) || !Array.isArray(message['content'])) {
      this.unknownBlock(
        line,
        value,
        '(contenido no reconocido)',
        'mensaje del asistente no reconocido'
      )
      return
    }
    const messageId = str(message['id'])
    const model = str(message['model'])
    const ids = messageId ? { messageId } : {}
    if (model && model !== SYNTHETIC_MODEL) this.models.add(model)
    if (this.info.firstCommand === undefined && this.pendingCommand !== undefined) {
      if (this.countsAsPrompt(value)) this.info.firstCommand = this.pendingCommand
    }

    for (const block of message['content']) {
      const type = isObj(block) ? str(block['type']) : undefined
      if (!isObj(block) || !type) {
        this.unknownBlock(line, value, '(sin tipo)', 'bloque sin tipo')
      } else if (type === 'text') {
        this.textMessages.add(messageId ?? str(value['uuid']) ?? `línea ${line}`)
        this.push(line, value, {
          kind: 'assistant-text',
          text: str(block['text']) ?? '',
          ...ids,
          ...(model ? { model } : {})
        })
      } else if (type === 'thinking' || type === 'redacted_thinking') {
        this.push(line, value, { kind: 'thinking', text: str(block['thinking']) ?? '', ...ids })
      } else if (type === 'tool_use') {
        const id = str(block['id']) ?? ''
        const name = str(block['name']) ?? '(sin nombre)'
        if (id) this.toolUses.add(id)
        this.push(line, value, { kind: 'tool-use', id, name, input: block['input'], ...ids })
        const subagent = id ? this.options.subagentsByToolUse?.get(id) : undefined
        if (subagent) {
          this.push(line, value, {
            kind: 'subagent-ref',
            toolUseId: id,
            agentId: subagent.agentId,
            ...(subagent.agentType ? { agentType: subagent.agentType } : {}),
            ...(subagent.description ? { description: subagent.description } : {})
          })
        }
      } else {
        this.unknownBlock(line, value, type, 'bloque del asistente desconocido')
      }
    }

    const key = usageKey(messageId, value['requestId'], model)
    if (key && model) {
      const timestamp = str(value['timestamp'])
      this.usageLedger.add([
        {
          key,
          model,
          usage: readUsage(message['usage']),
          ...(timestamp ? { timestamp } : {}),
          ...(this.options.agentId ? { agentId: this.options.agentId } : {})
        }
      ])
    }
  }
}

/** Orden de versiones `a.b.c` numérico (2.1.10 > 2.1.9); lo demás, alfabético. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return a.localeCompare(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
