import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { LimitWindow } from '../../../shared/usage'
import { callUsage } from '../sdk-usage'
import { randomUUID } from 'node:crypto'
import type {
  ChatCatalog,
  ChatActivity,
  ChatDraft,
  ChatErrorView,
  ChatEvent,
  ChatEventBody,
  ChatMode,
  ChatPermissionInput,
  ChromeState,
  ChatSnapshot,
  ChatStatus,
  QueuedMessage,
  TurnResult
} from '../../../shared/chat'
import type { TranscriptItem } from '../../../shared/sessions'
import { logger as defaultLogger, type Logger } from '../logger'
import {
  chatError,
  createDraftPacer,
  mapRunError,
  resultErrorMessage,
  SdkMapper,
  type DraftPacer,
  type MappedEvent
} from './chat-mapper'
import type { ImageBlock } from './attachments'
import { InputQueue } from './input-queue'
import { PermissionBroker, type CanUseToolOptions } from './permissions'
import {
  EMPTY_TASKS,
  ENDED_VISIBLE_MS,
  hasRunningTasks,
  pruneTasks,
  reduceTasks,
  visibleTasks,
  type TasksState
} from './tasks'
import { t } from '../../i18n'

/**
 * Una sesión de chat activa: su `query()` del Agent SDK con entrada en
 * streaming, el estado (cola, permisos, tareas, elementos en vivo) y la traducción a `ChatEvent`.
 * Si el proceso de Claude Code termina, la sesión queda `closed` y el siguiente mensaje lo vuelve a
 * lanzar con `resume`. Nunca registra contenido.
 */

/** Lo que la sesión usa de un `Query` del SDK; los tests lo sustituyen. */
export interface QueryLike extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>
  setModel(model?: string): Promise<void>
  setPermissionMode(mode: ChatMode): Promise<void>
  stopTask(taskId: string): Promise<void>
  supportedModels(): Promise<
    { value: string; displayName: string; description: string; resolvedModel?: string }[]
  >
  supportedCommands(): Promise<{ name: string; description: string }[]>
  /** Estado de los servidores MCP (Claude en Chrome). */
  mcpServerStatus?(): Promise<{ name: string; status: string }[]>
  close(): void
}

export type QueryFactory = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => QueryLike

export interface ChatSessionDeps {
  query: QueryFactory
  /** Opciones comunes (`baseOptions`). */
  base: Options
  emit(event: ChatEvent): void
  /** Fin de cada turno: el servicio pide una pasada del índice. */
  onTurnEnd?(session: ChatSession): void
  /** Llega el id de la sesión (o cambia, si Claude Code la continuó en otra). */
  onSessionId?(session: ChatSession, previous: string | null): void
  onCatalog?(catalog: ChatCatalog): void
  /** `rate_limit_event` recibido: el `LimitsService` lo fusiona. */
  onRateLimit?(window: LimitWindow): void
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => number
  /** Espera antes de `query.close()` al cerrar (por defecto `CLOSE_GRACE_MS`). */
  closeGraceMs?: number
}

export interface ChatSessionInit {
  cwd: string
  /** Id de la sesión a reanudar; sin él, sesión nueva. */
  resume?: string
  model?: string | null
  /** Sin él, Claude Code aplica el modo de sus ajustes (`defaultMode`). */
  mode?: ChatMode
  /** Claude en Chrome (`--chrome`). */
  chrome?: boolean
  /** De incógnito: `persistSession: false`, así que el proceso no se puede reanudar. */
  incognito?: boolean
}

/**
 * Cambio que obligaría a relanzar el proceso de una sesión de incógnito ya empezada: sin
 * transcript en disco, el proceso nuevo no recordaría la conversación.
 */
export class IncognitoRestartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IncognitoRestartError'
  }
}

/** Servidor MCP de Claude in Chrome que añade `--chrome`. */
const CHROME_SERVER = 'claude-in-chrome'

/** Plazo para cerrar el proceso a la fuerza si no termina solo. */
const CLOSE_GRACE_MS = 3000

export class ChatSession {
  readonly chatId = randomUUID()
  sessionId: string | null
  readonly cwd: string
  readonly incognito: boolean
  status: ChatStatus = 'idle'
  model: string | null
  mode: ChatMode
  lastActivity: number

  private readonly deps: ChatSessionDeps
  private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>
  private readonly now: () => number
  private seq = 0

  private query: QueryLike | null = null
  private input: InputQueue<SDKUserMessage> | null = null
  private abort: AbortController | null = null
  /** Sube con cada `query()`: el final del bucle de uno viejo no afecta al nuevo. */
  private generation = 0
  /** Se resuelve cuando termina el bucle del `query()` actual. */
  private loopDone: Promise<void> = Promise.resolve()
  private mapper = new SdkMapper()
  private broker: PermissionBroker
  private tasks: TasksState = EMPTY_TASKS
  private pruneTimer: ReturnType<typeof setTimeout> | null = null

  private queue: QueuedMessage[] = []
  /** Texto de cada mensaje que la app ha entregado al SDK, hasta que Claude lo recibe. */
  private readonly sent = new Map<string, string>()
  /** Entregados con `priority: 'next'` («Enviar ya» en mitad de un turno). */
  private readonly sentNow = new Set<string>()
  /** Imágenes de los mensajes aún no recibidos por Claude, por `uuid`. */
  private readonly images = new Map<string, ImageBlock[]>()
  private live: TranscriptItem[] = []
  private liveSubagents: Record<string, TranscriptItem[]> = {}
  private draft: ChatDraft | null = null
  private readonly pacer: DraftPacer
  private progress: Record<string, number> = {}
  private error: ChatErrorView | null = null
  private commands: ChatCatalog['commands'] = []

  private turnActive = false
  private turnStartedAt: number | null = null
  private activity: ChatActivity | null = null
  private interruptRequested = false
  /** El proceso se lanzó con `allowDangerouslySkipPermissions`. */
  private bypassAllowed = false
  /** Modo que se aplicará al terminar el turno (cambio que necesita reiniciar). */
  private pendingMode: ChatMode | null = null
  /** Se eligió un modo (o ya lo dijo Claude Code): se pasa al lanzar el proceso. */
  private modeChosen: boolean
  private chrome: ChromeState
  /** El proceso actual se lanzó con `--chrome`. */
  private chromeLaunched = false
  /** Cambio de Claude en Chrome que espera al final del turno. */
  private pendingChrome: boolean | null = null
  private closing = false
  private unknownLogged = 0

  constructor(init: ChatSessionInit, deps: ChatSessionDeps) {
    this.deps = deps
    this.log = deps.log ?? defaultLogger
    this.now = deps.now ?? Date.now
    this.cwd = init.cwd
    this.incognito = init.incognito === true
    this.sessionId = init.resume ?? null
    this.model = init.model ?? null
    this.mode = init.mode ?? 'default'
    this.modeChosen = init.mode !== undefined
    this.chrome = init.chrome
      ? { enabled: true, status: 'pending' }
      : { enabled: false, status: 'off' }
    this.lastActivity = this.now()
    this.broker = this.createBroker()
    this.broker.setAutoAllow(this.mode === 'bypassPermissions')
    this.pacer = createDraftPacer((draft) => {
      this.draft = draft
      this.send_({
        kind: 'text-delta',
        messageId: draft.messageId,
        text: draft.text,
        at: this.now()
      })
    })
  }

  // ------------------------------------------------------------------ consultas

  get pendingPermissions(): number {
    return this.broker.size
  }

  get working(): boolean {
    return this.turnActive
  }

  /** Puede cerrarse por inactividad: en reposo, sin tareas vivas ni permisos. */
  get idleForClose(): boolean {
    return (
      !this.incognito &&
      !this.turnActive &&
      this.broker.size === 0 &&
      !hasRunningTasks(this.tasks) &&
      !this.queue.some((q) => q.state === 'sending')
    )
  }

  get hasProcess(): boolean {
    return this.query !== null
  }

  snapshot(): ChatSnapshot {
    return {
      chatId: this.chatId,
      seq: this.seq,
      sessionId: this.sessionId,
      cwd: this.cwd,
      status: this.status,
      model: this.model,
      mode: this.mode,
      queue: this.queue.map((q) => ({ ...q })),
      permissions: this.broker.list(),
      decisions: { ...this.broker.decisions },
      tasks: visibleTasks(this.tasks),
      live: [...this.live],
      liveSubagents: Object.fromEntries(
        Object.entries(this.liveSubagents).map(([k, v]) => [k, [...v]])
      ),
      draft: this.draft ? { ...this.draft } : null,
      progress: { ...this.progress },
      error: this.error,
      turnStartedAt: this.turnStartedAt,
      activity: this.activity,
      commands: this.commands,
      chrome: { ...this.chrome },
      incognito: this.incognito
    }
  }

  // ------------------------------------------------------------------ acciones

  /**
   * Envía un mensaje. Sin turno en curso empieza uno; con turno, sin `now` va a la
   * cola de la app y con `now` se entrega ya con `priority: 'next'`. Lo entregado queda en la cola
   * como `sending` hasta que Claude lo recibe, para verlo atenuado. Las imágenes
   * adjuntas esperan por `uuid` hasta la entrega; el texto de la cola se sigue pudiendo
   * editar.
   */
  send(
    text: string,
    uuid: string = randomUUID(),
    now = false,
    images: readonly ImageBlock[] = []
  ): string {
    this.touch()
    if (this.closing) throw new Error(t('La sesión se está cerrando'))
    if (images.length > 0) this.images.set(uuid, [...images])
    const extra = images.length > 0 ? { images: images.length } : {}
    if (!this.turnActive && !this.queue.some((q) => q.state === 'sending')) {
      this.queue.push({ uuid, text, state: 'sending', ...extra })
      this.emitQueue()
      this.deliver(uuid, text, false)
      return uuid
    }
    if (now) {
      this.queue.push({ uuid, text, state: 'sending', ...extra })
      this.deliver(uuid, text, true)
    } else {
      this.queue.push({ uuid, text, state: 'queued', ...extra })
    }
    this.emitQueue()
    return uuid
  }

  queueEdit(uuid: string, text: string): boolean {
    const item = this.queue.find((q) => q.uuid === uuid && q.state === 'queued')
    if (!item) return false
    item.text = text
    this.emitQueue()
    return true
  }

  queueRemove(uuid: string): boolean {
    const index = this.queue.findIndex((q) => q.uuid === uuid && q.state === 'queued')
    if (index === -1) return false
    this.queue.splice(index, 1)
    this.images.delete(uuid)
    this.emitQueue()
    return true
  }

  /** Un mensaje en cola pasa a «enviar ya». */
  queueSendNow(uuid: string): boolean {
    const item = this.queue.find((q) => q.uuid === uuid && q.state === 'queued')
    if (!item) return false
    this.touch()
    item.state = 'sending'
    this.emitQueue()
    this.deliver(item.uuid, item.text, this.turnActive)
    return true
  }

  /** Detener: conserva lo recibido y la cola; cancela los permisos. */
  async interrupt(): Promise<void> {
    this.touch()
    if (!this.turnActive || !this.query) return
    this.interruptRequested = true
    this.broker.cancelAll()
    try {
      await this.query.interrupt()
    } catch (error) {
      this.log.warn('chat', `Interrupción fallida en ${this.chatId}: ${String(error)}`)
    }
  }

  respond(answer: Omit<ChatPermissionInput, 'sessionId'>): boolean {
    this.touch()
    const ok = this.broker.respond(answer)
    if (!ok) this.log.warn('chat', `Permiso ignorado en ${this.chatId}`)
    return ok
  }

  async setModel(model: string | null): Promise<void> {
    this.touch()
    this.model = model
    this.send_({ kind: 'model', model })
    if (this.query) await this.query.setModel(model ?? undefined)
  }

  /**
   * Modo de permisos al momento. «Saltar permisos» necesita lanzar el proceso con
   * `allowDangerouslySkipPermissions` (comprobado): hasta entonces la app aprueba por su cuenta
   * las herramientas; en reposo se cierra el proceso y el siguiente mensaje lo relanza con el
   * flag; con un turno en curso, al terminar. De incógnito ya empezada no se relanza (se perdería
   * la conversación): la app sigue aprobando.
   */
  async setMode(mode: ChatMode): Promise<void> {
    this.touch()
    this.modeChosen = true
    this.pendingMode = null
    if (mode === 'bypassPermissions' && !this.bypassAllowed && this.query) {
      this.applyModeLocally(mode)
      if (this.incognito && this.sessionId !== null) return
      if (this.turnActive) {
        this.pendingMode = mode
        return
      }
      void this.stopProcess()
      return
    }
    this.applyModeLocally(mode)
    if (this.query) await this.query.setPermissionMode(mode)
  }

  /**
   * Claude en Chrome: es un flag del proceso, así que, como «Saltar permisos», en reposo
   * se cierra el proceso y el siguiente mensaje lo relanza (con `resume`); trabajando, al terminar
   * el turno.
   */
  setChrome(enabled: boolean): void {
    this.touch()
    if (this.chrome.enabled === enabled && this.pendingChrome === null) return
    if (this.query && this.chromeLaunched !== enabled) this.assertCanRestart()
    if (this.query && this.turnActive) {
      this.pendingChrome = enabled
      return
    }
    this.pendingChrome = null
    this.setChromeState(enabled ? { enabled, status: 'pending' } : { enabled, status: 'off' })
    if (this.query && this.chromeLaunched !== enabled) void this.stopProcess()
  }

  async stopTask(taskId: string): Promise<void> {
    this.touch()
    if (!this.query) return
    await this.query.stopTask(taskId)
  }

  /**
   * El renderer ya tiene de disco estos `uuid` (o `sourceUuid`): se quitan de lo vivo. Lo
   * propio sin `uuid` (duración del turno) también sale si ya no hay turno.
   */
  reconcile(uuids: readonly string[]): void {
    const known = new Set(uuids)
    const before = this.live.length
    this.live = this.live.filter((item) => {
      if (item.uuid && known.has(item.uuid)) return false
      if (!item.uuid && !this.turnActive) return false
      return true
    })
    for (const [toolUseId, items] of Object.entries(this.liveSubagents)) {
      const running = [...this.tasks.tasks.values()].some(
        (t) => t.toolUseId === toolUseId && t.status === 'running'
      )
      if (!running && !this.turnActive) delete this.liveSubagents[toolUseId]
      else this.liveSubagents[toolUseId] = items
    }
    if (this.live.length !== before || !this.turnActive)
      this.send_({ kind: 'reconciled', uuids: [...known] })
  }

  /** Cierra la sesión: cancela permisos, cierra la entrada y, si no basta, el proceso. */
  close(): Promise<void> {
    this.closing = true
    this.broker.cancelAll()
    this.pacer.clear()
    if (this.pruneTimer) clearTimeout(this.pruneTimer)
    return this.stopProcess()
  }

  // ------------------------------------------------------------------ proceso

  /** De incógnito, relanzar un proceso ya usado perdería la conversación. */
  private assertCanRestart(): void {
    if (!this.incognito || this.sessionId === null) return
    throw new IncognitoRestartError(
      t('En una sesión de incógnito este cambio haría perder la conversación.')
    )
  }

  private ensureQuery(): void {
    if (this.query) return
    const generation = ++this.generation
    const input = new InputQueue<SDKUserMessage>()
    const abort = new AbortController()
    const bypass = this.mode === 'bypassPermissions'
    const chrome = this.chrome.enabled
    const options: Options = {
      ...this.deps.base,
      cwd: this.cwd,
      abortController: abort,
      ...(this.modeChosen ? { permissionMode: this.mode } : {}),
      ...(bypass ? { allowDangerouslySkipPermissions: true } : {}),
      // Sin el flag, Claude Code decide según su configuración (`claudeInChromeDefaultEnabled`).
      ...(chrome ? { extraArgs: { ...this.deps.base.extraArgs, chrome: null } } : {}),
      // De incógnito no hay nada en disco que reanudar.
      ...(this.incognito ? { persistSession: false } : {}),
      ...(this.sessionId && !this.incognito ? { resume: this.sessionId } : {}),
      ...(this.model ? { model: this.model } : {}),
      canUseTool: (name, toolInput, opts) =>
        this.broker.canUseTool(name, toolInput, opts as CanUseToolOptions)
    }
    this.bypassAllowed = bypass
    this.chromeLaunched = chrome
    this.input = input
    this.abort = abort
    this.mapper = new SdkMapper()
    this.status = 'starting'
    this.send_({ kind: 'status', status: 'starting' })
    let query: QueryLike
    try {
      query = this.deps.query({ prompt: input, options })
    } catch (error) {
      this.processEnded(generation, error)
      return
    }
    this.query = query
    this.log.info('chat', `Proceso de Claude Code lanzado para ${this.chatId}`)
    this.loopDone = this.loop(generation, query)
  }

  private async loop(generation: number, query: QueryLike): Promise<void> {
    try {
      for await (const msg of query) {
        if (generation !== this.generation) break
        this.handle(msg)
      }
      this.processEnded(generation, null)
    } catch (error) {
      this.processEnded(generation, error)
    }
  }

  private stopProcess(): Promise<void> {
    const query = this.query
    const input = this.input
    if (!query) {
      if (this.status !== 'closed' && this.closing) this.setStatus('closed')
      return Promise.resolve()
    }
    this.generation += 1
    this.query = null
    this.input = null
    input?.close()
    const abort = this.abort
    this.abort = null
    this.endTurnSilently()
    if (this.chrome.enabled) this.setChromeState({ enabled: true, status: 'pending' })
    this.setStatus(this.closing ? 'closed' : 'idle')
    // Cerrar la entrada basta para que Claude Code termine; si no lo hace a tiempo, se fuerza.
    const grace = new Promise<void>((resolve) =>
      setTimeout(resolve, this.deps.closeGraceMs ?? CLOSE_GRACE_MS)
    )
    return Promise.race([this.loopDone, grace]).then(() => {
      try {
        query.close()
      } catch {
        // Ya estaba cerrado.
      }
      abort?.abort()
    })
  }

  private processEnded(generation: number, error: unknown): void {
    if (generation !== this.generation) return
    const aborted = this.closing || (this.abort?.signal.aborted ?? false)
    this.query = null
    this.input = null
    this.abort = null
    this.broker.cancelAll()
    this.pacer.clear()
    // Lo que Claude no llegó a recibir vuelve a la cola: no se queda «Enviando…».
    const unsent = this.queue.filter((q) => q.state === 'sending')
    for (const item of unsent) {
      item.state = 'queued'
      this.sent.delete(item.uuid)
      this.sentNow.delete(item.uuid)
    }
    if (unsent.length > 0) this.emitQueue()
    const view = error ? mapRunError(error, aborted) : null
    if (view) {
      this.log.error('chat', `Proceso de ${this.chatId} terminado con error (${view.code})`)
      this.setError(view)
    } else if (!aborted && this.turnActive) {
      this.setError(chatError('process'))
    }
    this.endTurnSilently()
    if (this.chrome.enabled) this.setChromeState({ enabled: true, status: 'pending' })
    this.setStatus('closed')
    this.log.info('chat', `Proceso de Claude Code de ${this.chatId} terminado`)
  }

  // ------------------------------------------------------------------ entrega

  private deliver(uuid: string, text: string, now: boolean): void {
    this.ensureQuery()
    if (!this.input) return
    this.sent.set(uuid, text)
    if (now) this.sentNow.add(uuid)
    // Se conservan hasta `started`: si una interrupción la devuelve a la cola, se reenvían.
    const images = this.images.get(uuid) ?? []
    const content: SDKUserMessage['message']['content'] =
      images.length > 0 ? [...images, ...(text ? [{ type: 'text' as const, text }] : [])] : text
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage['uuid'],
      ...(now ? { priority: 'next' as const } : {})
    }
    this.input.push(message)
    if (!this.turnActive) this.startTurn()
  }

  /** Al terminar bien un turno se entrega el primero de la cola, uno por turno. */
  private deliverNextQueued(): boolean {
    const next = this.queue.find((q) => q.state === 'queued')
    if (!next) return false
    next.state = 'sending'
    this.emitQueue()
    this.deliver(next.uuid, next.text, false)
    return true
  }

  // ------------------------------------------------------------------ mensajes del SDK

  private handle(msg: unknown): void {
    this.touch()
    for (const event of this.mapper.map(msg)) this.apply(event)
    if (this.mapper.unknown > this.unknownLogged) {
      this.unknownLogged = this.mapper.unknown
      if (this.unknownLogged % 20 === 1)
        this.log.info(
          'chat',
          `Mensajes del SDK no reconocidos en ${this.chatId}: ${this.unknownLogged}`
        )
    }
  }

  /** Consulta de uso del SDK sobre el proceso vivo, o `null` si no hay. */
  readUsage(): Promise<unknown> | null {
    return this.query ? callUsage(this.query) : null
  }

  private apply(event: MappedEvent): void {
    switch (event.kind) {
      case 'rate-limit':
        this.send_({ kind: 'rate-limit', window: event.window })
        this.deps.onRateLimit?.(event.window)
        return
      case 'init': {
        const previous = this.sessionId
        this.sessionId = event.sessionId || previous
        if (event.model) this.model = this.model ?? event.model
        if (event.mode && event.mode !== this.mode && this.mode !== 'bypassPermissions')
          this.applyModeLocally(event.mode)
        if (event.mode) this.modeChosen = true
        if (this.status === 'starting') this.setStatus(this.turnActive ? 'working' : 'idle')
        this.send_({
          kind: 'session',
          sessionId: this.sessionId ?? '',
          model: event.model,
          cwd: event.cwd || this.cwd
        })
        if (this.sessionId !== previous) this.deps.onSessionId?.(this, previous)
        void this.refreshCatalog()
        void this.refreshChrome()
        return
      }
      case 'items':
        this.beginTurnIfIdle()
        // Un bloque completo cierra la actividad que lo anunció.
        this.activity = null
        this.addLive(event.items)
        return
      case 'subagent-items': {
        const list = this.liveSubagents[event.toolUseId] ?? []
        list.push(...event.items)
        this.liveSubagents[event.toolUseId] = list
        this.send_({ kind: 'subagent-items', toolUseId: event.toolUseId, items: event.items })
        return
      }
      case 'draft':
        this.beginTurnIfIdle()
        this.pacer.push({ messageId: event.messageId, text: event.text })
        return
      case 'activity':
        this.beginTurnIfIdle()
        this.activity = event.activity
        this.send_({ kind: 'activity', activity: event.activity })
        return
      case 'draft-clear':
        this.pacer.clear()
        if (this.draft) {
          this.draft = null
          this.send_({ kind: 'draft-clear' })
        }
        return
      case 'tool-progress':
        this.progress[event.toolUseId] = event.elapsedMs
        this.send_({
          kind: 'tool-progress',
          toolUseId: event.toolUseId,
          elapsedMs: event.elapsedMs
        })
        return
      case 'lifecycle':
        this.onLifecycle(event.commandUuid, event.state)
        return
      case 'task':
        this.onTask(event.message)
        return
      case 'result':
        this.onResult(event)
        return
      case 'error':
        this.setError(event.error)
        return
    }
  }

  private addLive(items: TranscriptItem[]): void {
    for (const item of items) {
      if (item.kind === 'tool-result' && item.toolUseId in this.progress)
        delete this.progress[item.toolUseId]
    }
    this.live.push(...items)
    this.send_({ kind: 'items', items })
  }

  private onLifecycle(uuid: string, state: string): void {
    const text = this.sent.get(uuid)
    if (text === undefined) return
    if (state === 'started') {
      this.sent.delete(uuid)
      const images = this.images.get(uuid)?.length ?? 0
      this.images.delete(uuid)
      const wasQueued = this.queue.some((q) => q.uuid === uuid)
      // Plegado en el turno en curso solo si entró con «Enviar ya» mientras trabajaba.
      const midTurn = this.turnActive && this.sentNow.delete(uuid)
      if (wasQueued) this.queue = this.queue.filter((q) => q.uuid !== uuid)
      this.beginTurnIfIdle()
      const timestamp = new Date(this.now()).toISOString()
      const item: TranscriptItem = {
        line: this.mapper.nextLine(),
        uuid,
        timestamp,
        sidechain: false,
        kind: 'user-prompt',
        text,
        images,
        ...(midTurn ? { queued: true as const, sourceUuid: uuid } : {})
      }
      this.addLive([item])
      // Después del prompt en vivo: el mensaje «Enviando…» no desaparece un instante.
      if (wasQueued) this.emitQueue()
      this.send_({ kind: 'delivered', uuid, text, queued: midTurn, timestamp })
    } else if (state === 'cancelled') {
      this.sent.delete(uuid)
      this.sentNow.delete(uuid)
      // Entregado con «enviar ya» pero descartado por una interrupción: vuelve a la cola.
      const item = this.queue.find((q) => q.uuid === uuid)
      if (item) {
        item.state = 'queued'
        this.emitQueue()
      }
    }
  }

  private onTask(message: Record<string, unknown>): void {
    const now = this.now()
    const next = reduceTasks(this.tasks, message, now)
    if (next === this.tasks) return
    const before = JSON.stringify(visibleTasks(this.tasks))
    this.tasks = next
    const tasks = visibleTasks(next)
    if (JSON.stringify(tasks) !== before) this.send_({ kind: 'tasks', tasks })
    this.schedulePrune()
  }

  private schedulePrune(): void {
    if (this.pruneTimer) return
    const ended = [...this.tasks.tasks.values()].some((t) => t.endedAt !== undefined)
    if (!ended) return
    this.pruneTimer = setTimeout(() => {
      this.pruneTimer = null
      const next = pruneTasks(this.tasks, this.now())
      if (next !== this.tasks) {
        this.tasks = next
        this.send_({ kind: 'tasks', tasks: visibleTasks(next) })
      }
      this.schedulePrune()
    }, ENDED_VISIBLE_MS + 100)
  }

  private onResult(event: Extract<MappedEvent, { kind: 'result' }>): void {
    this.pacer.clear()
    if (this.draft) {
      this.draft = null
      this.send_({ kind: 'draft-clear' })
    }
    const result: TurnResult = this.interruptRequested
      ? 'interrupted'
      : event.isError
        ? 'error'
        : 'success'
    this.interruptRequested = false
    if (result === 'error')
      this.setError(chatError('turn', event.detail, resultErrorMessage(event.subtype)))
    // «Trabajó durante…» en vivo hasta que llega de disco.
    if (event.durationMs > 0) {
      this.addLive([
        {
          line: this.mapper.nextLine(),
          timestamp: new Date(this.now()).toISOString(),
          sidechain: false,
          kind: 'system',
          subtype: 'turn_duration',
          durationMs: event.durationMs
        }
      ])
    }
    this.turnActive = false
    this.turnStartedAt = null
    this.activity = null
    this.progress = {}
    this.send_({ kind: 'turn-end', durationMs: event.durationMs, result })
    this.log.info('chat', `Turno de ${this.chatId} terminado (${result}) en ${event.durationMs} ms`)

    if (this.pendingMode) {
      const mode = this.pendingMode
      this.pendingMode = null
      void this.setMode(mode)
    }
    if (this.pendingChrome !== null) {
      const chrome = this.pendingChrome
      this.pendingChrome = null
      this.setChrome(chrome)
    }
    // Lo entregado en reposo abrió este turno: si su `started` no llegó, ya está consumido.
    const opened = this.queue.filter((q) => q.state === 'sending' && !this.sentNow.has(q.uuid))
    if (opened.length > 0) {
      for (const item of opened) this.sent.delete(item.uuid)
      this.queue = this.queue.filter((q) => !opened.includes(q))
      this.emitQueue()
    }
    const continues =
      this.queue.some((q) => q.state === 'sending') ||
      (result === 'success' && this.query !== null && this.deliverNextQueued())
    if (!continues) this.setStatus(this.broker.size > 0 ? 'waiting' : 'idle')
    this.deps.onTurnEnd?.(this)
  }

  // ------------------------------------------------------------------ estado

  private startTurn(): void {
    this.turnActive = true
    this.turnStartedAt = this.now()
    this.activity = null
    this.error = null
    this.send_({ kind: 'turn-start', startedAt: this.turnStartedAt })
    if (this.status !== 'starting') this.setStatus(this.broker.size > 0 ? 'waiting' : 'working')
  }

  /** Claude abre turnos solo, p. ej. al terminar una tarea en segundo plano. */
  private beginTurnIfIdle(): void {
    if (!this.turnActive) this.startTurn()
  }

  private endTurnSilently(): void {
    if (!this.turnActive) return
    this.turnActive = false
    this.turnStartedAt = null
    this.activity = null
    this.progress = {}
    this.interruptRequested = false
    this.send_({ kind: 'turn-end', durationMs: 0, result: 'interrupted' })
  }

  private setStatus(status: ChatStatus): void {
    if (this.status === status) return
    this.status = status
    this.send_({ kind: 'status', status })
  }

  private setError(error: ChatErrorView): void {
    this.error = error
    this.send_({ kind: 'error', error })
  }

  private applyModeLocally(mode: ChatMode): void {
    this.broker.setAutoAllow(mode === 'bypassPermissions')
    if (this.mode === mode) return
    this.mode = mode
    this.send_({ kind: 'mode', mode })
  }

  private createBroker(): PermissionBroker {
    return new PermissionBroker({
      onRequest: (request) => {
        this.touch()
        this.send_({ kind: 'permission', request })
        if (this.turnActive) this.setStatus('waiting')
      },
      onResolved: (request, decision) => {
        this.send_({
          kind: 'permission-resolved',
          requestId: request.requestId,
          ...(request.toolUseId ? { toolUseId: request.toolUseId } : {}),
          decision
        })
        if (this.broker.size === 0 && this.status === 'waiting')
          this.setStatus(this.turnActive ? 'working' : 'idle')
      },
      onModeChange: (mode) => this.applyModeLocally(mode),
      onAllowAll: () => {
        this.setMode('bypassPermissions').catch((error: unknown) =>
          this.log.warn('chat', `No se pudo pasar a Saltar permisos: ${String(error)}`)
        )
      },
      log: (message) => this.log.warn('chat', message)
    })
  }

  private setChromeState(chrome: ChromeState): void {
    if (this.chrome.enabled === chrome.enabled && this.chrome.status === chrome.status) return
    this.chrome = chrome
    this.send_({ kind: 'chrome', chrome: { ...chrome } })
  }

  /** Tras `init`: ¿está conectado el servidor de Claude in Chrome?. */
  private async refreshChrome(attempt = 0): Promise<void> {
    const query = this.query
    if (!query?.mcpServerStatus || !this.chrome.enabled) return
    try {
      const servers = await query.mcpServerStatus()
      if (query !== this.query || !this.chrome.enabled) return
      const server = servers.find((s) => s.name === CHROME_SERVER)
      this.setChromeState({
        enabled: true,
        status: server?.status === 'connected' ? 'connected' : server ? 'pending' : 'failed'
      })
      if (server?.status === 'failed') {
        this.setChromeState({ enabled: true, status: 'failed' })
      } else if (server && server.status !== 'connected' && attempt < 5) {
        // Aún conectando: se vuelve a mirar en un momento.
        setTimeout(() => void this.refreshChrome(attempt + 1), 2000)
      }
    } catch (error) {
      this.log.warn('chat', `No se pudo leer el estado de Claude en Chrome: ${String(error)}`)
    }
  }

  private emitQueue(): void {
    this.send_({ kind: 'queue', queue: this.queue.map((q) => ({ ...q })) })
  }

  private async refreshCatalog(): Promise<void> {
    const query = this.query
    if (!query) return
    try {
      const [models, commands] = await Promise.all([
        query.supportedModels(),
        query.supportedCommands()
      ])
      // Recortado a lo que guarda `state.json` (las descripciones de skills pueden ser largas).
      const cut = (text: string, max: number): string =>
        text.length > max ? `${text.slice(0, max - 1)}…` : text
      const catalog: ChatCatalog = {
        models: models.slice(0, 100).map((m) => ({
          value: cut(m.value, 100),
          ...(m.resolvedModel ? { resolvedModel: cut(m.resolvedModel, 100) } : {}),
          displayName: cut(m.displayName, 200),
          description: cut(m.description, 1000)
        })),
        commands: commands
          .slice(0, 1000)
          .map((c) => ({ name: cut(c.name, 200), description: cut(c.description, 300) }))
      }
      this.commands = catalog.commands
      this.send_({ kind: 'commands', commands: catalog.commands })
      this.deps.onCatalog?.(catalog)
    } catch (error) {
      this.log.warn('chat', `No se pudo leer el catálogo de modelos y comandos: ${String(error)}`)
    }
  }

  private touch(): void {
    this.lastActivity = this.now()
  }

  private send_(body: ChatEventBody): void {
    this.seq += 1
    this.deps.emit({ chatId: this.chatId, seq: this.seq, ...body } as ChatEvent)
  }
}
