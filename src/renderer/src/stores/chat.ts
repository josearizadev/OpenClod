import { defineStore } from 'pinia'
import type { LimitWindow } from '../../../shared/usage'
import { computed, reactive, ref, shallowRef, toRaw } from 'vue'
import type {
  ChatAttachment,
  ChatCatalog,
  ChatEvent,
  ChatMode,
  ChatPermissionInput,
  ChatSnapshot,
  ChatStatus,
  QueuedMessage,
  TurnResult
} from '../../../shared/chat'

/**
 * Sesiones de chat activas en el renderer. Se suscribe a `chat:event` una
 * sola vez (desde `App.vue`), así sigue todas las sesiones aunque no se vean. Cada
 * evento lleva un `seq` creciente: tras un `snapshot`, los anteriores se descartan.
 */

export interface ChatSessionState extends ChatSnapshot {
  /** Último fin de turno, para «Trabajó durante» y para recargar de disco. */
  lastTurn: { result: TurnResult; durationMs: number; at: number } | null
  /** Se incrementa con cada fin de turno: la vista recarga el transcript al cambiar. */
  turnEnds: number
  /** Último `rate_limit_event` con aviso o rechazo. */
  rateLimit: LimitWindow | null
}

function blank(chatId: string): ChatSessionState {
  return {
    chatId,
    seq: 0,
    sessionId: null,
    cwd: '',
    status: 'starting',
    model: null,
    mode: 'default',
    queue: [],
    permissions: [],
    decisions: {},
    tasks: [],
    live: [],
    liveSubagents: {},
    draft: null,
    progress: {},
    error: null,
    turnStartedAt: null,
    activity: null,
    commands: [],
    chrome: { enabled: false, status: 'off' },
    lastTurn: null,
    turnEnds: 0,
    rateLimit: null
  }
}

/**
 * Primer texto de cada turno: marca al recibirlo y medida tras pintarlo, con el tiempo
 * desde que el main lo emitió (mismo reloj del sistema en los dos procesos).
 */
function markFirstText(emittedAt: number | undefined): void {
  performance.mark('bitacora:chat-primer-texto')
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const latency = emittedAt ? Date.now() - emittedAt : undefined
      performance.measure('bitacora:chat-primer-texto-pintado', {
        start: 'bitacora:chat-primer-texto',
        detail: { desdeElMainMs: latency }
      })
    })
  )
}

/** Clave del borrador del compositor de la pantalla de bienvenida (sesión aún sin id). */
export const NEW_DRAFT = 'new'

/** Copia plana: un proxy reactivo de Vue no se puede clonar por IPC. */
function plain(attachments: readonly ChatAttachment[]): ChatAttachment[] {
  return attachments.map((a) => ({ ...toRaw(a) }))
}

export interface ChatStartError {
  code: string
  message: string
}

export const useChatStore = defineStore('chat', () => {
  /** Por `chatId`. `reactive` para que cada cambio se vea; los arrays de elementos se sustituyen. */
  const sessions = reactive(new Map<string, ChatSessionState>())
  /** `sessionId` → `chatId` (también los alias de una conversación reanudada). */
  const aliases = reactive(new Map<string, string>())
  /** Borradores del compositor por `sessionId` o `NEW_DRAFT`; solo en memoria. */
  const drafts = reactive(new Map<string, string>())
  /** Adjuntos del borrador, con la misma clave. */
  const draftAttachments = reactive(new Map<string, ChatAttachment[]>())
  const catalog = shallowRef<ChatCatalog>({ models: [], commands: [] })
  const subscribed = ref(false)
  /**
   * Mensajes enviados cuya llamada al main aún no ha vuelto, por `sessionId`: al
   * retomar una sesión cerrada, la vista aún no tiene su estado y sin esto no se verían.
   */
  const outbox = reactive(new Map<string, Pick<QueuedMessage, 'uuid' | 'text' | 'images'>[]>())
  /** Sesiones cuyo primer texto del turno ya se marcó. */
  const firstText = new Set<string>()

  function byChatId(chatId: string): ChatSessionState {
    let state = sessions.get(chatId)
    if (!state) {
      sessions.set(chatId, blank(chatId))
      state = sessions.get(chatId) as ChatSessionState
    }
    return state
  }

  function stateOf(sessionId: string | null | undefined): ChatSessionState | null {
    if (!sessionId) return null
    const chatId = aliases.get(sessionId)
    return chatId ? (sessions.get(chatId) ?? null) : null
  }

  /** Estado para la lista y la cabecera: `null` = no activa. */
  function statusOf(sessionId: string): ChatStatus | null {
    return stateOf(sessionId)?.status ?? null
  }

  function apply(event: ChatEvent): void {
    const s = byChatId(event.chatId)
    if (event.seq <= s.seq) return
    s.seq = event.seq
    switch (event.kind) {
      case 'session':
        s.sessionId = event.sessionId || s.sessionId
        if (s.sessionId) aliases.set(s.sessionId, s.chatId)
        if (event.cwd) s.cwd = event.cwd
        s.model ??= event.model || null
        // El main guarda los modelos y comandos de la sesión al arrancar.
        setTimeout(() => void refreshCatalog(), 2000)
        break
      case 'status':
        s.status = event.status
        break
      case 'items':
        s.live = [...s.live, ...event.items]
        // Como en el main: el bloque completo cierra la actividad que lo anunció.
        s.activity = null
        break
      case 'subagent-items':
        s.liveSubagents = {
          ...s.liveSubagents,
          [event.toolUseId]: [...(s.liveSubagents[event.toolUseId] ?? []), ...event.items]
        }
        break
      case 'text-delta':
        s.draft = { messageId: event.messageId, text: event.text }
        if (!firstText.has(s.chatId)) {
          firstText.add(s.chatId)
          markFirstText(event.at)
        }
        break
      case 'draft-clear':
        s.draft = null
        break
      case 'activity':
        s.activity = event.activity
        break
      case 'tool-progress':
        s.progress = { ...s.progress, [event.toolUseId]: event.elapsedMs }
        break
      case 'queue':
        s.queue = event.queue
        break
      case 'delivered':
        break
      case 'permission':
        s.permissions = [...s.permissions, event.request]
        break
      case 'permission-resolved':
        s.permissions = s.permissions.filter((p) => p.requestId !== event.requestId)
        if (event.toolUseId) s.decisions = { ...s.decisions, [event.toolUseId]: event.decision }
        break
      case 'tasks':
        s.tasks = event.tasks
        break
      case 'turn-start':
        s.turnStartedAt = event.startedAt
        s.activity = null
        s.error = null
        firstText.delete(s.chatId)
        break
      case 'turn-end':
        s.turnStartedAt = null
        s.activity = null
        s.progress = {}
        s.draft = null
        s.lastTurn = { result: event.result, durationMs: event.durationMs, at: Date.now() }
        s.turnEnds += 1
        break
      case 'mode':
        s.mode = event.mode
        break
      case 'model':
        s.model = event.model
        break
      case 'error':
        s.error = event.error
        break
      case 'commands':
        s.commands = event.commands
        break
      case 'chrome':
        s.chrome = event.chrome
        break
      case 'reconciled':
        applyReconciled(s, event.uuids)
        break
      case 'rate-limit':
        s.rateLimit = event.window.status === 'allowed' ? null : event.window
        break
    }
  }

  /** Lo mismo que hace el main al conciliar. */
  function applyReconciled(s: ChatSessionState, uuids: readonly string[]): void {
    const known = new Set(uuids)
    const working = s.turnStartedAt !== null
    s.live = s.live.filter((item) => (item.uuid ? !known.has(item.uuid) : working))
    if (!working) {
      const running = new Set(s.tasks.filter((t) => t.status === 'running').map((t) => t.toolUseId))
      s.liveSubagents = Object.fromEntries(
        Object.entries(s.liveSubagents).filter(([id]) => running.has(id))
      )
    }
  }

  /** Se llama una vez al arrancar: eventos de todas las sesiones y estado de las ya activas. */
  async function init(): Promise<() => void> {
    if (subscribed.value) return () => {}
    subscribed.value = true
    const off = window.api.chat.onEvent(apply)
    const [active, cat] = await Promise.all([window.api.chat.active(), window.api.chat.catalog()])
    if (cat.ok) catalog.value = cat.data
    if (active.ok) {
      for (const entry of active.data) if (entry.sessionId) await sync(entry.sessionId)
    }
    return () => {
      off()
      subscribed.value = false
    }
  }

  async function refreshCatalog(): Promise<void> {
    const result = await window.api.chat.catalog()
    if (result.ok) catalog.value = result.data
  }

  /** Estado completo al volver a una sesión. */
  async function sync(sessionId: string): Promise<void> {
    const result = await window.api.chat.snapshot(sessionId)
    if (!result.ok || !result.data) return
    const snap = result.data
    const s = byChatId(snap.chatId)
    if (snap.seq < s.seq) return
    Object.assign(s, snap)
    if (snap.sessionId) aliases.set(snap.sessionId, snap.chatId)
    aliases.set(sessionId, snap.chatId)
  }

  // ------------------------------------------------------------------ acciones

  async function start(args: {
    cwd: string
    text: string
    attachments?: ChatAttachment[]
    model: string | null
    mode: ChatMode
    chrome?: boolean
  }): Promise<{ ok: true; chatId: string } | { ok: false; error: ChatStartError }> {
    const { attachments, ...rest } = args
    const result = await window.api.chat.start({
      ...rest,
      ...(attachments?.length ? { attachments: plain(attachments) } : {})
    })
    if (!result.ok) return { ok: false, error: result.error }
    const s = byChatId(result.data.chatId)
    s.cwd ||= args.cwd
    s.mode = args.mode
    s.model ??= args.model
    if (args.chrome) s.chrome = { enabled: true, status: 'pending' }
    return { ok: true, chatId: result.data.chatId }
  }

  /** Mensaje a una sesión (activa o no): si trabaja, va a la cola, o «enviar ya» con `now`. */
  async function send(
    sessionId: string,
    text: string,
    now = false,
    attachments: ChatAttachment[] = [],
    options: { chrome?: boolean } = {}
  ): Promise<{ ok: true } | { ok: false; error: ChatStartError }> {
    // Se entrega ya (no va a la cola): se ve atenuado al momento, con el `uuid` que tendrá.
    const s = stateOf(sessionId)
    const immediate =
      now || !s || (s.turnStartedAt === null && !s.queue.some((q) => q.state === 'sending'))
    const uuid = crypto.randomUUID()
    if (immediate) {
      const images = attachments.filter((a) => a.kind === 'image').length
      const entry = { uuid, text, ...(images ? { images } : {}) }
      outbox.set(sessionId, [...(outbox.get(sessionId) ?? []), entry])
    }
    const result = await window.api.chat.send({
      sessionId,
      uuid,
      text,
      ...(now ? { now } : {}),
      ...(attachments.length > 0 ? { attachments: plain(attachments) } : {}),
      ...(options.chrome !== undefined ? { chrome: options.chrome } : {})
    })
    // La cola del main (con este mensaje) llega antes que la respuesta: ya no hace falta aquí.
    const left = (outbox.get(sessionId) ?? []).filter((m) => m.uuid !== uuid)
    if (left.length > 0) outbox.set(sessionId, left)
    else outbox.delete(sessionId)
    if (!result.ok) return { ok: false, error: result.error }
    aliases.set(sessionId, result.data.chatId)
    byChatId(result.data.chatId)
    return { ok: true }
  }

  const call = {
    queueEdit: (sessionId: string, uuid: string, text: string) =>
      window.api.chat.queueEdit({ sessionId, uuid, text }),
    queueRemove: (sessionId: string, uuid: string) =>
      window.api.chat.queueRemove({ sessionId, uuid }),
    queueSendNow: (sessionId: string, uuid: string) =>
      window.api.chat.queueSendNow({ sessionId, uuid }),
    interrupt: (sessionId: string) => window.api.chat.interrupt(sessionId),
    respond: (input: ChatPermissionInput) => window.api.chat.permission(input),
    setModel: (sessionId: string, model: string | null) =>
      window.api.chat.setModel(sessionId, model),
    setMode: (sessionId: string, mode: ChatMode) => window.api.chat.setMode(sessionId, mode),
    setChrome: (sessionId: string, enabled: boolean) =>
      window.api.chat.setChrome(sessionId, enabled),
    stopTask: (sessionId: string, taskId: string) => window.api.chat.stopTask(sessionId, taskId),
    close: (sessionId: string) => window.api.chat.close(sessionId)
  }

  /** El transcript de disco ya trae estos `uuid`: fuera de lo vivo, aquí y en el main. */
  function reconciled(sessionId: string, uuids: string[]): void {
    const s = stateOf(sessionId)
    if (!s) return
    applyReconciled(s, uuids)
    void window.api.chat.reconciled(sessionId, uuids)
  }

  function clearError(sessionId: string): void {
    const s = stateOf(sessionId)
    if (s) s.error = null
  }

  const activeCount = computed(() => sessions.size)
  const workingCount = computed(
    () =>
      [...sessions.values()].filter((s) => s.status === 'working' || s.status === 'waiting').length
  )

  /**
   * Mensajes entregados que Claude aún no ha recibido: los de la llamada en curso
   * y los `sending` de la cola del main.
   */
  function pendingOf(sessionId: string): Pick<QueuedMessage, 'uuid' | 'text' | 'images'>[] {
    const sending = stateOf(sessionId)?.queue.filter((q) => q.state === 'sending') ?? []
    const early = (outbox.get(sessionId) ?? []).filter(
      (m) => !sending.some((q) => q.uuid === m.uuid)
    )
    return [...sending, ...early]
  }

  return {
    sessions,
    drafts,
    draftAttachments,
    catalog,
    activeCount,
    workingCount,
    init,
    sync,
    stateOf,
    statusOf,
    pendingOf,
    start,
    send,
    reconciled,
    clearError,
    refreshCatalog,
    ...call
  }
})
