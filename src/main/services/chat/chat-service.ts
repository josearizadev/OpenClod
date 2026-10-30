import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { LimitWindow } from '../../../shared/usage'
import type {
  ChatActiveEntry,
  ChatAttachment,
  ChatCatalog,
  ChatEvent,
  ChatMode,
  ChatPermissionInput,
  ChatSnapshot
} from '../../../shared/chat'
import { logger as defaultLogger, type Logger } from '../logger'
import { AttachmentError, buildUserContent, type UserContent } from './attachments'
import { checkCwd, cwdErrorMessage } from './claude-runtime'
import { ChatSession, IncognitoRestartError, type QueryFactory } from './chat-session'
import { t } from '../../i18n'

/**
 * Registro de las sesiones de chat activas. Varias a la vez, sin límite
 *; una en reposo se cierra tras 10 min sin actividad ni tareas vivas y el
 * siguiente mensaje la reanuda. Las de Claude Code las escribe Claude Code: la app nunca escribe
 * en su carpeta.
 */

export const IDLE_CLOSE_MS = 10 * 60_000
const IDLE_CHECK_MS = 60_000

/** Error previsto: la capa IPC lo pasa tal cual al renderer. */
export class ChatServiceError extends Error {
  constructor(
    readonly code: 'INVALID_CWD' | 'NOT_FOUND' | 'INVALID_ARGS',
    message: string
  ) {
    super(message)
    this.name = 'ChatServiceError'
  }
}

/** Sesión que reanudar: la última de su conversación, su carpeta y el último modelo. */
export interface ResumeTarget {
  sessionId: string
  cwd: string
  model?: string
}

export interface ChatServiceDeps {
  query: QueryFactory
  /** Opciones comunes (`baseOptions`); se leen en cada sesión nueva por si cambian los ajustes. */
  base: () => Options
  claudeDir: () => string
  resumeTarget: (sessionId: string) => ResumeTarget | null
  emit: (event: ChatEvent) => void
  onTurnEnd?: () => void
  onCatalog?: (catalog: ChatCatalog) => void
  onRateLimit?: (window: LimitWindow) => void
  /** Claude en Chrome por defecto en esa carpeta (preferencia del proyecto). */
  chromeDefault?: (cwd: string) => boolean
  /** Modelos conocidos: `setModel` solo acepta estos (y `null`). */
  knownModels?: () => string[]
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => number
  closeGraceMs?: number
}

export interface StartArgs {
  cwd: string
  text: string
  attachments?: ChatAttachment[] | undefined
  uuid?: string
  model?: string | null
  mode?: ChatMode
  chrome?: boolean
  /** No se guarda en disco: al cerrarla desaparece. */
  incognito?: boolean
}

export interface SendArgs {
  sessionId: string
  text: string
  attachments?: ChatAttachment[] | undefined
  uuid?: string
  now?: boolean
  chrome?: boolean
}

export class ChatService {
  private readonly sessions = new Set<ChatSession>()
  private readonly bySessionId = new Map<string, ChatSession>()
  private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>
  private readonly now: () => number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: ChatServiceDeps) {
    this.log = deps.log ?? defaultLogger
    this.now = deps.now ?? Date.now
  }

  /** Sesión nueva en una carpeta. */
  async start(args: StartArgs): Promise<{ chatId: string; uuid: string }> {
    const check = await checkCwd(args.cwd, this.deps.claudeDir())
    if (!check.ok) throw new ChatServiceError('INVALID_CWD', cwdErrorMessage(check.reason))
    const content = await this.content(args.text, args.attachments)
    const session = this.create({
      cwd: check.path,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      chrome: args.chrome ?? this.deps.chromeDefault?.(check.path) ?? false,
      ...(args.incognito ? { incognito: true } : {})
    })
    const uuid = session.send(content.text, args.uuid, false, content.images)
    this.log.info(
      'chat',
      `Sesión nueva ${session.chatId}${session.incognito ? ' (incógnito)' : ''}`
    )
    return { chatId: session.chatId, uuid }
  }

  /** Mensaje a una sesión: si no está activa, se reanuda la última de su conversación. */
  async send(args: SendArgs): Promise<{ chatId: string; uuid: string }> {
    // Los adjuntos se validan antes de reanudar nada: un error no deja un proceso abierto.
    const content = await this.content(args.text, args.attachments)
    let session = this.bySessionId.get(args.sessionId)
    if (!session) {
      const target = this.deps.resumeTarget(args.sessionId)
      if (!target) throw new ChatServiceError('NOT_FOUND', t('La sesión ya no existe.'))
      session = this.bySessionId.get(target.sessionId)
      if (!session) {
        const check = await checkCwd(target.cwd, this.deps.claudeDir())
        if (!check.ok) {
          throw new ChatServiceError(
            'INVALID_CWD',
            check.reason === 'missing'
              ? t('La carpeta de esta sesión ya no existe.')
              : cwdErrorMessage(check.reason)
          )
        }
        const model = this.validModel(target.model)
        session = this.create({
          cwd: check.path,
          resume: target.sessionId,
          ...(model ? { model } : {}),
          chrome: args.chrome ?? this.deps.chromeDefault?.(check.path) ?? false
        })
        // El renderer puede seguir usando el id que tenía (la sesión anterior de la cadena).
        if (args.sessionId !== target.sessionId) this.bySessionId.set(args.sessionId, session)
        this.log.info('chat', `Sesión ${target.sessionId} reanudada (${session.chatId})`)
      }
    }
    const uuid = session.send(content.text, args.uuid, args.now === true, content.images)
    return { chatId: session.chatId, uuid }
  }

  /** Texto e imágenes del mensaje. */
  private async content(text: string, attachments: ChatAttachment[] = []): Promise<UserContent> {
    if (attachments.length === 0) return { text, images: [] }
    try {
      return await buildUserContent(text, attachments, { claudeDir: this.deps.claudeDir() })
    } catch (error) {
      if (error instanceof AttachmentError)
        throw new ChatServiceError('INVALID_ARGS', error.message)
      throw error
    }
  }

  get(sessionId: string): ChatSession | undefined {
    return this.bySessionId.get(sessionId)
  }

  require(sessionId: string): ChatSession {
    const session = this.bySessionId.get(sessionId)
    if (!session) throw new ChatServiceError('NOT_FOUND', t('La sesión no está activa.'))
    return session
  }

  queueEdit(sessionId: string, uuid: string, text: string): void {
    this.require(sessionId).queueEdit(uuid, text)
  }

  queueRemove(sessionId: string, uuid: string): void {
    this.require(sessionId).queueRemove(uuid)
  }

  queueSendNow(sessionId: string, uuid: string): void {
    this.require(sessionId).queueSendNow(uuid)
  }

  interrupt(sessionId: string): Promise<void> {
    return this.require(sessionId).interrupt()
  }

  respond(input: ChatPermissionInput): void {
    const { sessionId, ...answer } = input
    this.require(sessionId).respond(answer)
  }

  async setModel(sessionId: string, model: string | null): Promise<void> {
    if (model !== null && this.validModel(model) === undefined)
      throw new ChatServiceError('INVALID_ARGS', t('Modelo desconocido.'))
    await this.require(sessionId).setModel(model)
  }

  async setMode(sessionId: string, mode: ChatMode): Promise<void> {
    const session = this.require(sessionId)
    await rejectRestart(() => session.setMode(mode))
  }

  async setChrome(sessionId: string, enabled: boolean): Promise<void> {
    const session = this.require(sessionId)
    await rejectRestart(() => session.setChrome(enabled))
  }

  stopTask(sessionId: string, taskId: string): Promise<void> {
    return this.require(sessionId).stopTask(taskId)
  }

  reconcile(sessionId: string, uuids: string[]): void {
    this.bySessionId.get(sessionId)?.reconcile(uuids)
  }

  snapshot(sessionId: string): ChatSnapshot | null {
    return this.bySessionId.get(sessionId)?.snapshot() ?? null
  }

  active(): ChatActiveEntry[] {
    return [...this.sessions].map((s) => ({
      chatId: s.chatId,
      sessionId: s.sessionId,
      status: s.status,
      incognito: s.incognito
    }))
  }

  /** Para la confirmación al cerrar la app. */
  busy(): { working: number; waiting: number } {
    let working = 0
    let waiting = 0
    for (const s of this.sessions) {
      if (s.pendingPermissions > 0) waiting += 1
      else if (s.working) working += 1
    }
    return { working, waiting }
  }

  /** Para eliminar una conversación: `active` si Claude trabaja o espera. */
  chatState(sessionId: string): 'active' | 'idle' | null {
    const session = this.bySessionId.get(sessionId)
    if (!session || session.status === 'closed') return session ? 'idle' : null
    return session.status === 'idle' ? 'idle' : 'active'
  }

  /**
   * Cierre explícito: libera el proceso; el siguiente mensaje reanuda. Una de incógnito
   * no se puede reanudar: cerrarla la borra.
   */
  async close(sessionId: string): Promise<void> {
    const session = this.bySessionId.get(sessionId)
    if (!session) return
    this.forget(session)
    await session.close()
  }

  /** Cierra todo de forma ordenada (salida de la app). */
  async closeAll(): Promise<void> {
    this.stopTimer()
    const all = [...this.sessions]
    for (const s of all) this.forget(s)
    await Promise.all(
      all.map(async (s) => {
        await s.interrupt().catch(() => undefined)
        await s.close()
      })
    )
  }

  /** Cierra las sesiones en reposo sin actividad desde hace `IDLE_CLOSE_MS`. */
  sweepIdle(): void {
    const now = this.now()
    for (const session of [...this.sessions]) {
      if (session.idleForClose && now - session.lastActivity > IDLE_CLOSE_MS) {
        this.log.info('chat', `Sesión ${session.chatId} cerrada por inactividad`)
        this.forget(session)
        void session.close()
      }
    }
  }

  /** Consulta de uso por el primer chat con proceso vivo, o `null`. */
  readUsage(): Promise<unknown> | null {
    for (const session of this.sessions) {
      const call = session.readUsage()
      if (call) return call
    }
    return null
  }

  get size(): number {
    return this.sessions.size
  }

  private create(init: ConstructorParameters<typeof ChatSession>[0]): ChatSession {
    const session = new ChatSession(init, {
      query: this.deps.query,
      base: this.deps.base(),
      emit: this.deps.emit,
      onTurnEnd: () => this.deps.onTurnEnd?.(),
      // Si Claude Code la continuó en otra sesión, se llega por los dos ids.
      onSessionId: (s) => {
        if (s.sessionId) this.bySessionId.set(s.sessionId, s)
      },
      ...(this.deps.onCatalog ? { onCatalog: this.deps.onCatalog } : {}),
      ...(this.deps.onRateLimit ? { onRateLimit: this.deps.onRateLimit } : {}),
      log: this.log,
      now: this.now,
      ...(this.deps.closeGraceMs !== undefined ? { closeGraceMs: this.deps.closeGraceMs } : {})
    })
    this.sessions.add(session)
    if (init.resume) this.bySessionId.set(init.resume, session)
    this.startTimer()
    return session
  }

  private forget(session: ChatSession): void {
    this.sessions.delete(session)
    for (const [id, s] of [...this.bySessionId]) if (s === session) this.bySessionId.delete(id)
    if (this.sessions.size === 0) this.stopTimer()
  }

  private validModel(model: string | undefined): string | undefined {
    if (!model) return undefined
    const known = this.deps.knownModels?.()
    if (!known || known.length === 0) return model
    return known.includes(model) ? model : undefined
  }

  private startTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sweepIdle(), IDLE_CHECK_MS)
    this.timer.unref?.()
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** El cambio pedido haría perder una sesión de incógnito: error previsto para el renderer. */
async function rejectRestart(fn: () => unknown): Promise<void> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof IncognitoRestartError)
      throw new ChatServiceError('INVALID_ARGS', error.message)
    throw error
  }
}
