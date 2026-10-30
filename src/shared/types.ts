import { z } from 'zod'
import { UsagePeriodSchema, UsageScopeSchema, type LimitsSnapshot } from './usage'
import { SearchScopeSchema } from './search'
import { ChatCommandSchema, ChatModelSchema, SavedChatModeSchema } from './chat'
import { LanguageSchema } from './i18n'

/** Preferencia de tema. `system` sigue el tema del sistema operativo. */
export const ThemeSchema = z.enum(['system', 'light', 'dark'])
export type Theme = z.infer<typeof ThemeSchema>

/** Filtros del visor de historial: preferencia de la app, no por sesión. */
export const ViewerSchema = z.object({
  tools: z.boolean(),
  thinking: z.boolean(),
  internal: z.boolean()
})
export type Viewer = z.infer<typeof ViewerSchema>

export const DEFAULT_VIEWER: Viewer = { tools: true, thinking: true, internal: false }

/** Preferencias del chat: valores por defecto de las sesiones nuevas. */
export const ChatSettingsSchema = z.object({
  /** `null` = el que use Claude Code por defecto. */
  model: z.string().max(100).nullable(),
  /** «Saltar permisos» nunca se guarda. */
  permissionMode: SavedChatModeSchema,
  /** Panel derecho de archivos abierto. */
  filesPanel: z.boolean()
})
export type ChatSettings = z.infer<typeof ChatSettingsSchema>

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  model: null,
  permissionMode: 'default',
  filesPanel: false
}

/** Notificaciones del sistema. */
export const NotificationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    turnEnd: z.boolean(),
    permission: z.boolean(),
    tasks: z.boolean(),
    limit: z.boolean(),
    /** Notificar también con la ventana enfocada. */
    whenFocused: z.boolean()
  })
  .strict()
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  turnEnd: true,
  permission: true,
  tasks: true,
  limit: true,
  whenFocused: false
}

/** Terminal de respaldo. */
export const TerminalSettingsSchema = z
  .object({
    /** `id` de un shell detectado; `null` = automático. */
    shell: z.string().max(40).nullable(),
    fontSize: z.number().int().min(11).max(24),
    /** Modo lector de pantalla de xterm.js. */
    screenReader: z.boolean()
  })
  .strict()
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>

export const DEFAULT_TERMINAL: TerminalSettings = { shell: null, fontSize: 13, screenReader: false }

/** Ventana: seguir en la bandeja al cerrar. */
export const WindowSettingsSchema = z.object({ closeToTray: z.boolean() }).strict()
export type WindowSettings = z.infer<typeof WindowSettingsSchema>

/** Órdenes del menú nativo y de la bandeja para la ventana (evento `app:command`). */
export const AppCommandSchema = z.enum([
  'new-session',
  'open-project',
  'search',
  'usage',
  'terminal',
  'settings',
  'diagnostics',
  'about'
])
export type AppCommand = z.infer<typeof AppCommandSchema>

/** Ajustes persistidos en `userData/state.json` por `AppStore`. */
export const SettingsSchema = z.object({
  theme: ThemeSchema,
  /** Idioma de la interfaz; `system` sigue el del sistema operativo. */
  language: LanguageSchema,
  /** Ya se vio la pantalla de bienvenida (idioma y sesión de Claude Code). */
  welcomed: z.boolean(),
  /** Carpeta de Claude Code elegida por el usuario; `null` = `CLAUDE_CONFIG_DIR` o `~/.claude`. */
  claudeDir: z.string().trim().min(1).max(1024).nullable(),
  viewer: ViewerSchema,
  chat: ChatSettingsSchema,
  /** Búsqueda global: solo el ámbito se recuerda entre ejecuciones. */
  search: z.object({ scope: SearchScopeSchema }).strict(),
  /** Vista Uso. */
  usage: z
    .object({
      period: UsagePeriodSchema,
      scope: UsageScopeSchema,
      /** Coste equivalente de API. */
      showCost: z.boolean(),
      /** Lanzar un proceso de Claude Code solo para consultar los límites. */
      probe: z.boolean()
    })
    .strict(),
  notifications: NotificationSettingsSchema,
  terminal: TerminalSettingsSchema,
  window: WindowSettingsSchema
})
export type Settings = z.infer<typeof SettingsSchema>

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'system',
  welcomed: false,
  claudeDir: null,
  viewer: { ...DEFAULT_VIEWER },
  chat: { ...DEFAULT_CHAT_SETTINGS },
  search: { scope: 'project' },
  usage: { period: '7d', scope: 'all', showCost: false, probe: true },
  notifications: { ...DEFAULT_NOTIFICATIONS },
  terminal: { ...DEFAULT_TERMINAL },
  window: { closeToTray: false }
}

/** Proyecto importado: una carpeta en la que se usa Claude Code. */
/** Iconos que se pueden elegir para un proyecto (el renderer los traduce a lucide). */
export const PROJECT_ICONS = [
  'folder',
  'monitor',
  'code',
  'terminal',
  'globe',
  'smartphone',
  'server',
  'database',
  'cloud',
  'bot',
  'brain',
  'sparkles',
  'book',
  'file',
  'pen',
  'palette',
  'camera',
  'music',
  'gamepad',
  'flask',
  'chart',
  'briefcase',
  'cart',
  'graduation',
  'house',
  'heart',
  'rocket',
  'wrench',
  'shield',
  'leaf'
] as const
export const ProjectIconSchema = z.enum(PROJECT_ICONS)
export type ProjectIcon = z.infer<typeof ProjectIconSchema>

/** Colores de proyecto: cada uno es un token `--project-*` con variante clara y oscura. */
export const PROJECT_COLORS = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
  'gray'
] as const
export const ProjectColorSchema = z.enum(PROJECT_COLORS)
export type ProjectColor = z.infer<typeof ProjectColorSchema>

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  /** Ruta tal como la eligió el usuario, normalizada (separadores, sin barra final). */
  path: z.string().min(1).max(1024),
  /** Nombre visible: el de la carpeta salvo que el usuario lo cambie. */
  name: z.string().min(1).max(256),
  /** `computer` = «Mi PC»: la carpeta personal, para lo que no es un proyecto. Sin él, `folder`. */
  kind: z.enum(['folder', 'computer']).optional(),
  icon: ProjectIconSchema.optional(),
  color: ProjectColorSchema.optional(),
  /** ISO. */
  addedAt: z.string(),
  /** ISO; ordena el selector. */
  lastOpenedAt: z.string()
})
export type Project = z.infer<typeof ProjectSchema>

/**
 * Datos propios de una conversación: nunca se escriben en la carpeta de
 * Claude Code. Una entrada sin `title`, `favorite` ni `hidden` no se guarda.
 */
export const SessionMetaSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  favorite: z.literal(true).optional(),
  hidden: z.literal(true).optional(),
  /** ISO de la última modificación. */
  updatedAt: z.string()
})
export type SessionMeta = z.infer<typeof SessionMetaSchema>

const ProjectPrefsSchema = z.object({ chrome: z.boolean() }).strict()
export type ProjectPrefs = z.infer<typeof ProjectPrefsSchema>

/**
 * Contenido completo de `state.json`: los ajustes más los proyectos. `settings:get`/`settings:set`
 * solo exponen `SettingsSchema`, así el renderer no puede escribir los proyectos por esa vía.
 */
export const StateSchema = SettingsSchema.extend({
  projects: z.array(ProjectSchema),
  activeProjectId: z.string().uuid().nullable(),
  /** Datos propios por `conversationId`. */
  sessionMeta: z.record(z.string().max(100), SessionMetaSchema),
  /** Preferencias de la app por proyecto: Claude en Chrome en sus sesiones. */
  projectPrefs: z.record(z.string().uuid(), ProjectPrefsSchema),
  /** Sesiones movidas a otro proyecto desde la app: `sessionId` → carpeta del destino. */
  sessionMoves: z.record(z.string().max(100), z.string().min(1).max(1024)),
  /** Última lista de modelos y comandos del SDK: sin datos sensibles. */
  chatCache: z.object({
    models: z.array(ChatModelSchema).max(100),
    commands: z.array(ChatCommandSchema).max(1000),
    updatedAt: z.string().nullable()
  }),
  /** Último estado de los límites; lo valida `LimitsService` al cargarlo. */
  limitsCache: z.custom<LimitsSnapshot | null>(
    (v) => v === null || (typeof v === 'object' && v !== null)
  ),
  /** Tamaño y posición de la ventana; lo valida `restoreBounds` al usarlo. */
  windowState: z.custom<{
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
  } | null>((v) => v === null || (typeof v === 'object' && v !== null))
})
export type State = z.infer<typeof StateSchema>

export const DEFAULT_STATE: State = {
  ...DEFAULT_SETTINGS,
  projects: [],
  activeProjectId: null,
  sessionMeta: {},
  projectPrefs: {},
  sessionMoves: {},
  chatCache: { models: [], commands: [], updatedAt: null },
  limitsCache: null,
  windowState: null
}

/** Versiones que muestra la vista de diagnóstico. */
export const SystemInfoSchema = z.object({
  app: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  /** Archivo de log del main, o `null` si solo se registra en consola. */
  logFile: z.string().nullable(),
  /** Versión de Git, o `null` si no está instalado. */
  git: z.string().nullable(),
  /** Versión de Claude Code que trae el Agent SDK («Acerca de»). */
  claudeCode: z.string().nullable()
})
export type SystemInfo = z.infer<typeof SystemInfoSchema>

/** «Abrir en OpenClod» en el menú contextual del Explorador de Windows. */
export const ShellMenuStatusSchema = z
  .object({
    /** Solo en Windows y con la app instalada. */
    supported: z.boolean(),
    /** Por qué no se puede: `platform` (no es Windows) o `dev` (versión de desarrollo). */
    reason: z.enum(['platform', 'dev']).optional(),
    enabled: z.boolean()
  })
  .strict()
export type ShellMenuStatus = z.infer<typeof ShellMenuStatusSchema>
