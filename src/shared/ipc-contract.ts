import { z } from 'zod'
import type { Result } from './result'
import {
  DiscoveredProjectSchema,
  IndexStatusSchema,
  IndexUpdatedSchema,
  ProjectViewSchema,
  SessionDetailSchema,
  SessionListItemSchema,
  SessionMetaStatsSchema,
  SessionTrashResultSchema,
  SessionMoveResultSchema
} from './projects'
import {
  ClaudeScanReportSchema,
  type SubagentTranscript,
  type TranscriptAppend,
  type TranscriptPayload
} from './sessions'
import {
  ChatEventSchema,
  ChatPermissionInputSchema,
  ChatQueueEditInputSchema,
  ChatQueueRefInputSchema,
  ChatReconciledInputSchema,
  ChatSendInputSchema,
  ChatSessionRefSchema,
  ChatSetChromeInputSchema,
  ChatSetModeInputSchema,
  ChatSetModelInputSchema,
  ChatStartInputSchema,
  ChatStopTaskInputSchema,
  type ChatActiveEntry,
  type ChatCatalog,
  type ChatSnapshot,
  type CloseRequest
} from './chat'
import {
  AppCommandSchema,
  ProjectColorSchema,
  ProjectIconSchema,
  SettingsSchema,
  ShellMenuStatusSchema,
  SystemInfoSchema
} from './types'
import {
  ClaudeMdWriteInputSchema,
  FileOpenInputSchema,
  FileRefInputSchema,
  FileTargetSchema,
  MentionsInputSchema,
  SessionExportInputSchema,
  type ClaudeMdFile,
  type ClaudeMdWrite,
  type FileDiff,
  type FilePreview,
  type MentionEntry
} from './files'
import type { GitInfo } from './git'
import {
  ProjectChromeInputSchema,
  ProjectSettingsReadInputSchema,
  ProjectSettingsWriteInputSchema,
  type ProjectSettings,
  type ProjectSettingsWrite
} from './project-settings'
import {
  TERMINAL_WRITE_MAX,
  TerminalIdSchema,
  TerminalOpenInputSchema,
  type TerminalInfo,
  type TerminalShells
} from './terminal'
import { SearchQuerySchema, type SearchResult } from './search'
import {
  UsageProbeInputSchema,
  UsageQuerySchema,
  type CostTotal,
  type LimitsSnapshot,
  type UsageReport
} from './usage'
import type { UpdateStatus } from './update'
import type { AuthStatus } from './auth'
import type { Locale } from './i18n'

/**
 * Contrato IPC: fuente única de canales, esquemas y tipos.
 * El main valida cada entrada con `input`; el preload y el renderer solo usan los tipos.
 */
export const invokeContract = {
  'settings:get': {
    input: z.void(),
    output: SettingsSchema
  },
  'settings:set': {
    input: SettingsSchema.partial().strict(),
    output: SettingsSchema
  },
  'system:ping': {
    input: z.object({ msg: z.string().max(200) }),
    output: z.object({ pong: z.string() })
  },
  'system:info': {
    input: z.void(),
    output: SystemInfoSchema
  },
  'system:pickFolder': {
    input: z
      .object({ purpose: z.enum(['workdir', 'claudeDir']) })
      .strict()
      .optional(),
    output: z.string().nullable()
  },
  /** «Abrir en OpenClod» en el menú contextual del Explorador de Windows. */
  'system:shellMenu': { input: z.void(), output: ShellMenuStatusSchema },
  'system:setShellMenu': {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: ShellMenuStatusSchema
  },
  /** La vista activa es de incógnito: marco oscuro también en los botones de la ventana. */
  'system:setIncognitoFrame': {
    input: z.object({ on: z.boolean() }).strict(),
    output: z.void()
  },
  /** Archivos para adjuntar al chat; vacío si se cancela. */
  'system:pickFiles': {
    input: z.void(),
    output: z.array(z.string())
  },
  'projects:list': {
    input: z.void(),
    output: z.array(ProjectViewSchema)
  },
  'projects:import': {
    input: z.object({ path: z.string().min(1).max(1024) }),
    output: ProjectViewSchema
  },
  'projects:importMany': {
    input: z.object({ paths: z.array(z.string().min(1).max(1024)).min(1).max(50) }),
    output: z.array(ProjectViewSchema)
  },
  'projects:remove': {
    input: z.object({ id: z.string().uuid() }),
    output: z.void()
  },
  /** Nombre, icono y color. `null` vuelve al valor por defecto. */
  'projects:customize': {
    input: z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().max(256).nullable().optional(),
        icon: ProjectIconSchema.nullable().optional(),
        color: ProjectColorSchema.nullable().optional()
      })
      .strict(),
    output: ProjectViewSchema
  },
  'projects:select': {
    input: z.object({ id: z.string().uuid() }),
    output: z.void()
  },
  'projects:active': {
    input: z.void(),
    output: z.string().nullable()
  },
  'projects:discover': {
    input: z.void(),
    output: z.array(DiscoveredProjectSchema)
  },
  'sessions:list': {
    input: z.object({ projectId: z.string().uuid() }),
    output: z.array(SessionListItemSchema)
  },
  'sessions:get': {
    input: z.object({ sessionId: z.string().min(1).max(100) }),
    output: SessionDetailSchema.nullable()
  },
  'sessions:update': {
    input: z
      .object({
        sessionId: z.string().min(1).max(100),
        title: z.string().max(200).nullable().optional(),
        favorite: z.boolean().optional(),
        hidden: z.boolean().optional()
      })
      .strict()
      .refine((p) => p.title !== undefined || p.favorite !== undefined || p.hidden !== undefined, {
        message: 'Falta el cambio'
      }),
    output: SessionListItemSchema.nullable()
  },
  /** Mover conversaciones enteras a la papelera del sistema. */
  'sessions:trash': {
    input: z.object({ sessionIds: z.array(z.string().min(1).max(100)).min(1).max(500) }).strict(),
    output: SessionTrashResultSchema
  },
  /** Mueve conversaciones (y sus archivos de Claude Code) a otro proyecto. */
  'sessions:move': {
    input: z
      .object({
        sessionIds: z.array(z.string().min(1).max(100)).min(1).max(500),
        projectId: z.string().uuid()
      })
      .strict(),
    output: SessionMoveResultSchema
  },
  'sessions:metaStats': {
    input: z.void(),
    output: SessionMetaStatsSchema
  },
  'sessions:transcript': {
    input: z.object({ sessionId: z.string().min(1).max(100) }),
    output: z.custom<TranscriptPayload>().nullable()
  },
  /** Dejar de seguir (`null`) la sesión de esta ventana; seguir lo activa `sessions:transcript`. */
  'sessions:follow': {
    input: z.object({ sessionId: z.string().min(1).max(100).nullable() }).strict(),
    output: z.void()
  },
  'sessions:subagent': {
    input: z.object({
      sessionId: z.string().min(1).max(100),
      agentId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
    }),
    output: z.custom<SubagentTranscript>().nullable()
  },
  'search:query': {
    input: SearchQuerySchema,
    output: z.custom<SearchResult>()
  },
  // Uso y límites.
  'usage:report': { input: UsageQuerySchema, output: z.custom<UsageReport>() },
  'usage:limits': { input: z.void(), output: z.custom<LimitsSnapshot>() },
  'usage:probe': { input: UsageProbeInputSchema, output: z.custom<LimitsSnapshot>() },
  'usage:sessionCost': {
    input: z.string().min(1).max(100),
    output: z.custom<CostTotal | null>()
  },
  // Git, archivos, CLAUDE.md y exportación.
  'git:info': {
    input: z.object({ target: FileTargetSchema, fresh: z.boolean().optional() }).strict(),
    output: z.custom<GitInfo | null>()
  },
  'files:read': { input: FileRefInputSchema, output: z.custom<FilePreview>() },
  'files:diff': { input: FileRefInputSchema, output: z.custom<FileDiff>() },
  'files:open': { input: FileOpenInputSchema, output: z.void() },
  'files:mentions': { input: MentionsInputSchema, output: z.custom<MentionEntry[]>() },
  'files:revealExport': {
    input: z.object({ path: z.string().min(1).max(1024) }).strict(),
    output: z.void()
  },
  'claudeMd:read': {
    input: z.object({ projectId: z.string().uuid() }).strict(),
    output: z.custom<ClaudeMdFile>()
  },
  'claudeMd:write': { input: ClaudeMdWriteInputSchema, output: z.custom<ClaudeMdWrite>() },
  'projectSettings:read': {
    input: ProjectSettingsReadInputSchema,
    output: z.custom<ProjectSettings>()
  },
  'projectSettings:write': {
    input: ProjectSettingsWriteInputSchema,
    output: z.custom<ProjectSettingsWrite>()
  },
  'projectSettings:setChrome': { input: ProjectChromeInputSchema, output: z.void() },
  'sessions:export': {
    input: SessionExportInputSchema,
    output: z.object({ path: z.string() }).nullable()
  },
  /** Sesión de Claude Code (`claude auth status`). */
  'auth:status': { input: z.void(), output: z.custom<AuthStatus>() },
  'claude:dir': {
    input: z.void(),
    output: z.object({ dir: z.string(), source: z.enum(['settings', 'env', 'default']) })
  },
  // Terminal de respaldo.
  'terminal:shells': { input: z.void(), output: z.custom<TerminalShells>() },
  'terminal:open': { input: TerminalOpenInputSchema, output: z.custom<TerminalInfo>() },
  'terminal:list': { input: z.void(), output: z.custom<TerminalInfo[]>() },
  'terminal:attach': {
    input: z.object({ id: TerminalIdSchema }).strict(),
    output: z.custom<{ info: TerminalInfo; buffer: string }>()
  },
  'terminal:write': {
    input: z.object({ id: TerminalIdSchema, data: z.string().max(TERMINAL_WRITE_MAX) }).strict(),
    output: z.void()
  },
  'terminal:resize': {
    input: z
      .object({
        id: TerminalIdSchema,
        cols: z.number().int().min(2).max(500),
        rows: z.number().int().min(1).max(300)
      })
      .strict(),
    output: z.void()
  },
  'terminal:restart': {
    input: z.object({ id: TerminalIdSchema }).strict(),
    output: z.custom<TerminalInfo>()
  },
  'terminal:close': { input: z.object({ id: TerminalIdSchema }).strict(), output: z.void() },
  'index:status': {
    input: z.void(),
    output: IndexStatusSchema
  },
  'index:refresh': {
    input: z.void(),
    output: z.void()
  },
  'index:rebuild': {
    input: z.void(),
    output: z.void()
  },
  'claude:scan': {
    input: z.void(),
    output: ClaudeScanReportSchema
  },
  // Chat con Claude Code. Solo ids, texto y valores de listas cerradas;
  // la única ruta es la carpeta de una sesión nueva, que el main comprueba.
  'chat:start': {
    input: ChatStartInputSchema,
    output: z.object({ chatId: z.string(), uuid: z.string() })
  },
  'chat:send': {
    input: ChatSendInputSchema,
    output: z.object({ chatId: z.string(), uuid: z.string() })
  },
  'chat:queueEdit': { input: ChatQueueEditInputSchema, output: z.void() },
  'chat:queueRemove': { input: ChatQueueRefInputSchema, output: z.void() },
  'chat:queueSendNow': { input: ChatQueueRefInputSchema, output: z.void() },
  'chat:interrupt': { input: ChatSessionRefSchema, output: z.void() },
  'chat:permission': { input: ChatPermissionInputSchema, output: z.void() },
  'chat:setModel': { input: ChatSetModelInputSchema, output: z.void() },
  'chat:setMode': { input: ChatSetModeInputSchema, output: z.void() },
  'chat:setChrome': { input: ChatSetChromeInputSchema, output: z.void() },
  'chat:stopTask': { input: ChatStopTaskInputSchema, output: z.void() },
  'chat:close': { input: ChatSessionRefSchema, output: z.void() },
  'chat:reconciled': { input: ChatReconciledInputSchema, output: z.void() },
  'chat:snapshot': {
    input: ChatSessionRefSchema,
    output: z.custom<ChatSnapshot>().nullable()
  },
  'chat:active': { input: z.void(), output: z.custom<ChatActiveEntry[]>() },
  'chat:catalog': { input: z.void(), output: z.custom<ChatCatalog>() },
  /** Salir tras confirmar el cierre con sesiones trabajando; `restart` instala la actualización. */
  'app:quit': {
    input: z.object({ restart: z.boolean() }).strict().optional(),
    output: z.void()
  },
  // Actualizaciones de la app.
  'update:status': { input: z.void(), output: z.custom<UpdateStatus>() },
  'update:check': { input: z.void(), output: z.void() },
  /** Reinicia para instalar; con trabajo vivo, antes pide confirmar (`app:closeRequest`). */
  'update:install': { input: z.void(), output: z.void() }
} as const

/** Eventos main → renderer. */
export const eventContract = {
  'chat:event': ChatEventSchema,
  'app:closeRequest': z.custom<CloseRequest>(),
  'index:updated': IndexUpdatedSchema,
  'sessions:appended': z.custom<TranscriptAppend>(),
  'usage:limits': z.custom<LimitsSnapshot>(),
  /** Abrir una ruta del router (p. ej. al pulsar una notificación). */
  'app:navigate': z.object({ path: z.string() }),
  /** Menú nativo y bandeja. */
  'app:command': z.object({ command: AppCommandSchema }),
  /** Carpeta abierta desde el Explorador: ya importada y activa. */
  'app:openedProject': z.object({ projectId: z.string() }),
  'terminal:data': z.custom<{ id: string; data: string }>(),
  'terminal:exit': z.custom<{ id: string; exitCode: number }>(),
  'update:status': z.custom<UpdateStatus>()
} as const satisfies Record<string, z.ZodType>

export type InvokeChannel = keyof typeof invokeContract
export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>

export type EventChannel = keyof typeof eventContract
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContract)[C]>

/** API que el preload expone como `window.api`. */
export interface Api {
  /** Idioma efectivo de la interfaz, leído al cargar la ventana. */
  locale: Locale
  auth: {
    status(): Promise<Result<InvokeOutput<'auth:status'>>>
  }
  settings: {
    get(): Promise<Result<InvokeOutput<'settings:get'>>>
    set(patch: InvokeInput<'settings:set'>): Promise<Result<InvokeOutput<'settings:set'>>>
  }
  system: {
    ping(msg: string): Promise<Result<InvokeOutput<'system:ping'>>>
    info(): Promise<Result<InvokeOutput<'system:info'>>>
    pickFolder(
      purpose?: 'workdir' | 'claudeDir'
    ): Promise<Result<InvokeOutput<'system:pickFolder'>>>
    pickFiles(): Promise<Result<InvokeOutput<'system:pickFiles'>>>
    shellMenu(): Promise<Result<InvokeOutput<'system:shellMenu'>>>
    setShellMenu(enabled: boolean): Promise<Result<InvokeOutput<'system:setShellMenu'>>>
    setIncognitoFrame(on: boolean): Promise<Result<void>>
  }
  git: {
    info(args: InvokeInput<'git:info'>): Promise<Result<InvokeOutput<'git:info'>>>
  }
  files: {
    read(args: InvokeInput<'files:read'>): Promise<Result<InvokeOutput<'files:read'>>>
    diff(args: InvokeInput<'files:diff'>): Promise<Result<InvokeOutput<'files:diff'>>>
    open(args: InvokeInput<'files:open'>): Promise<Result<void>>
    mentions(args: InvokeInput<'files:mentions'>): Promise<Result<InvokeOutput<'files:mentions'>>>
    revealExport(path: string): Promise<Result<void>>
    /** Ruta en disco de un archivo soltado o pegado; `''` si no tiene. Sin IPC. */
    pathFor(file: File): string
  }
  terminal: {
    shells(): Promise<Result<InvokeOutput<'terminal:shells'>>>
    open(args: InvokeInput<'terminal:open'>): Promise<Result<InvokeOutput<'terminal:open'>>>
    list(): Promise<Result<InvokeOutput<'terminal:list'>>>
    attach(id: string): Promise<Result<InvokeOutput<'terminal:attach'>>>
    write(id: string, data: string): Promise<Result<void>>
    resize(id: string, cols: number, rows: number): Promise<Result<void>>
    restart(id: string): Promise<Result<InvokeOutput<'terminal:restart'>>>
    close(id: string): Promise<Result<void>>
    onData(callback: (event: EventPayload<'terminal:data'>) => void): () => void
    onExit(callback: (event: EventPayload<'terminal:exit'>) => void): () => void
  }
  claudeMd: {
    read(projectId: string): Promise<Result<InvokeOutput<'claudeMd:read'>>>
    write(args: InvokeInput<'claudeMd:write'>): Promise<Result<InvokeOutput<'claudeMd:write'>>>
  }
  /** Ajustes del proyecto. */
  projectSettings: {
    read(projectId: string): Promise<Result<InvokeOutput<'projectSettings:read'>>>
    write(
      args: InvokeInput<'projectSettings:write'>
    ): Promise<Result<InvokeOutput<'projectSettings:write'>>>
    setChrome(projectId: string, enabled: boolean): Promise<Result<void>>
  }
  projects: {
    list(): Promise<Result<InvokeOutput<'projects:list'>>>
    import(path: string): Promise<Result<InvokeOutput<'projects:import'>>>
    importMany(paths: string[]): Promise<Result<InvokeOutput<'projects:importMany'>>>
    remove(id: string): Promise<Result<InvokeOutput<'projects:remove'>>>
    customize(
      input: InvokeInput<'projects:customize'>
    ): Promise<Result<InvokeOutput<'projects:customize'>>>
    select(id: string): Promise<Result<InvokeOutput<'projects:select'>>>
    active(): Promise<Result<InvokeOutput<'projects:active'>>>
    discover(): Promise<Result<InvokeOutput<'projects:discover'>>>
  }
  sessions: {
    list(projectId: string): Promise<Result<InvokeOutput<'sessions:list'>>>
    get(sessionId: string): Promise<Result<InvokeOutput<'sessions:get'>>>
    /** Renombrar, favorita u ocultar (datos propios en `state.json`). */
    update(patch: InvokeInput<'sessions:update'>): Promise<Result<InvokeOutput<'sessions:update'>>>
    /** Mueve a la papelera las conversaciones de esas entradas. */
    trash(sessionIds: string[]): Promise<Result<InvokeOutput<'sessions:trash'>>>
    move(sessionIds: string[], projectId: string): Promise<Result<InvokeOutput<'sessions:move'>>>
    metaStats(): Promise<Result<InvokeOutput<'sessions:metaStats'>>>
    /** Transcript leído en el momento de la carpeta de Claude Code; `null` si ya no existe. */
    transcript(sessionId: string): Promise<Result<InvokeOutput<'sessions:transcript'>>>
    subagent(sessionId: string, agentId: string): Promise<Result<InvokeOutput<'sessions:subagent'>>>
    follow(sessionId: string | null): Promise<Result<void>>
    /** Exporta la conversación a Markdown; `null` si se cancela el diálogo. */
    export(args: InvokeInput<'sessions:export'>): Promise<Result<InvokeOutput<'sessions:export'>>>
    /** Lo nuevo de la sesión abierta. Devuelve la función para desuscribirse. */
    onAppended(callback: (event: EventPayload<'sessions:appended'>) => void): () => void
  }
  index: {
    status(): Promise<Result<InvokeOutput<'index:status'>>>
    /** Pasada incremental; se resuelve al terminar (la propia o la que ya estaba en curso). */
    refresh(): Promise<Result<InvokeOutput<'index:refresh'>>>
    rebuild(): Promise<Result<InvokeOutput<'index:rebuild'>>>
    /** Devuelve la función para desuscribirse. */
    onUpdated(callback: (event: EventPayload<'index:updated'>) => void): () => void
  }
  search: {
    /** Búsqueda global en prompts y respuestas. */
    query(args: InvokeInput<'search:query'>): Promise<Result<InvokeOutput<'search:query'>>>
  }
  usage: {
    report(query: InvokeInput<'usage:report'>): Promise<Result<InvokeOutput<'usage:report'>>>
    limits(): Promise<Result<InvokeOutput<'usage:limits'>>>
    /** «Consultar ahora»: pide los límites a Claude Code (chat abierto o sonda). */
    probe(force: boolean): Promise<Result<InvokeOutput<'usage:probe'>>>
    /** Coste equivalente de la conversación (solo con el ajuste activado), o `null`. */
    sessionCost(sessionId: string): Promise<Result<InvokeOutput<'usage:sessionCost'>>>
    /** Devuelve la función para desuscribirse. */
    onLimits(callback: (snapshot: EventPayload<'usage:limits'>) => void): () => void
  }
  claude: {
    /** Analiza la carpeta de Claude Code (Diagnóstico). */
    scan(): Promise<Result<InvokeOutput<'claude:scan'>>>
    /** Carpeta de Claude Code en uso y de dónde sale (Ajustes). */
    dir(): Promise<Result<InvokeOutput<'claude:dir'>>>
  }
  chat: {
    start(args: InvokeInput<'chat:start'>): Promise<Result<InvokeOutput<'chat:start'>>>
    send(args: InvokeInput<'chat:send'>): Promise<Result<InvokeOutput<'chat:send'>>>
    queueEdit(args: InvokeInput<'chat:queueEdit'>): Promise<Result<void>>
    queueRemove(args: InvokeInput<'chat:queueRemove'>): Promise<Result<void>>
    queueSendNow(args: InvokeInput<'chat:queueSendNow'>): Promise<Result<void>>
    interrupt(sessionId: string): Promise<Result<void>>
    permission(args: InvokeInput<'chat:permission'>): Promise<Result<void>>
    setModel(sessionId: string, model: string | null): Promise<Result<void>>
    setMode(sessionId: string, mode: InvokeInput<'chat:setMode'>['mode']): Promise<Result<void>>
    setChrome(sessionId: string, enabled: boolean): Promise<Result<void>>
    stopTask(sessionId: string, taskId: string): Promise<Result<void>>
    close(sessionId: string): Promise<Result<void>>
    /** El renderer ya tiene de disco estos `uuid`: el main los quita de lo vivo. */
    reconciled(sessionId: string, uuids: string[]): Promise<Result<void>>
    snapshot(sessionId: string): Promise<Result<InvokeOutput<'chat:snapshot'>>>
    active(): Promise<Result<InvokeOutput<'chat:active'>>>
    catalog(): Promise<Result<InvokeOutput<'chat:catalog'>>>
    /** Devuelve la función para desuscribirse. */
    onEvent(callback: (event: EventPayload<'chat:event'>) => void): () => void
  }
  app: {
    quit(restart?: boolean): Promise<Result<void>>
    /** El main pide confirmar el cierre. Devuelve la función para desuscribirse. */
    onCloseRequest(callback: (request: EventPayload<'app:closeRequest'>) => void): () => void
    onNavigate(callback: (event: EventPayload<'app:navigate'>) => void): () => void
    onCommand(callback: (event: EventPayload<'app:command'>) => void): () => void
    onOpenedProject(callback: (event: EventPayload<'app:openedProject'>) => void): () => void
  }
  update: {
    status(): Promise<Result<InvokeOutput<'update:status'>>>
    check(): Promise<Result<void>>
    install(): Promise<Result<void>>
    /** Devuelve la función para desuscribirse. */
    onStatus(callback: (status: EventPayload<'update:status'>) => void): () => void
  }
}
