import { z } from 'zod'
import { TokenUsageSchema } from './sessions'
import { ProjectSchema } from './types'

/**
 * Tipos IPC de proyectos, lista de sesiones e índice. Los produce el main
 * a partir del índice (`index-queries.ts`) y de `state.json` (`projects.ts`).
 */

/** Proyecto con lo que muestra el selector. */
export const ProjectViewSchema = ProjectSchema.extend({
  /** Entradas de la lista de sesiones (una por conversación). */
  sessionCount: z.number(),
  lastActivityAt: z.string().nullable(),
  /** La carpeta ya no existe en disco. */
  missing: z.boolean()
})
export type ProjectView = z.infer<typeof ProjectViewSchema>

/** Carpeta de trabajo con sesiones que aún no es un proyecto. */
export const DiscoveredProjectSchema = z.object({
  /** Primer `cwd` normalizado de la sesión más reciente, con sus mayúsculas. */
  path: z.string(),
  sessionCount: z.number(),
  lastActivityAt: z.string().nullable()
})
export type DiscoveredProject = z.infer<typeof DiscoveredProjectSchema>

/**
 * Entrada de la lista. En una conversación continuada: `sessionId`, `title`, `updatedAt` y
 * `gitBranch` de la última sesión, `startedAt` de la primera y `usage` = suma del uso propio de
 * la cadena.
 */
export const SessionListItemSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  startedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  gitBranch: z.string().optional(),
  usage: TokenUsageSchema,
  chainLength: z.number(),
  /** `mtime` más reciente (ms) de los archivos de la sesión de la entrada. */
  lastWriteAt: z.number().optional(),
  /** Datos propios de la conversación. */
  favorite: z.boolean(),
  hidden: z.boolean()
})
export type SessionListItem = z.infer<typeof SessionListItemSchema>

export const TitleSourceSchema = z.enum([
  'app',
  'agent-name',
  'ai-title',
  'prompt',
  'command',
  'none'
])

/** Ficha de una sesión. `usage` es el de la conversación; `ownUsage`, el de esta sesión. */
export const SessionDetailSchema = SessionListItemSchema.extend({
  titleSource: TitleSourceSchema,
  models: z.array(z.string()),
  messageCount: z.number(),
  toolCallCount: z.number(),
  subagentCount: z.number(),
  ownUsage: TokenUsageSchema,
  /** Primer `cwd` de la sesión. */
  cwd: z.string().optional(),
  continuedFrom: z.string().optional(),
  /** Ids de la conversación, de la primera sesión a la última. */
  chain: z.array(z.string())
})
export type SessionDetail = z.infer<typeof SessionDetailSchema>

/** Recuento de los datos propios para Diagnóstico. */
export const SessionMetaStatsSchema = z.object({
  entries: z.number(),
  /** Entradas sin ninguna sesión de esa conversación en el índice (se conservan). */
  orphaned: z.number(),
  favorites: z.number(),
  hidden: z.number()
})
export type SessionMetaStats = z.infer<typeof SessionMetaStatsSchema>

/** Resultado de eliminar conversaciones: ids de las entradas pedidas. */
export const SessionTrashResultSchema = z.object({
  trashed: z.array(z.string()),
  skipped: z.array(
    z.object({
      sessionId: z.string(),
      /** `active`: Claude trabaja en ella; `failed`: la papelera falló o la ruta no era válida. */
      reason: z.enum(['active', 'not-found', 'failed'])
    })
  )
})
export type SessionTrashResult = z.infer<typeof SessionTrashResultSchema>

export const LastPassSchema = z.object({
  finishedAt: z.string(),
  durationMs: z.number(),
  filesRead: z.number(),
  changedSessions: z.number(),
  removedSessions: z.number()
})
export type LastPass = z.infer<typeof LastPassSchema>

/** Estado del índice para Diagnóstico. Si no se pudo abrir, `ok: false` y `error`. */
export const IndexStatusSchema = z.object({
  path: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  sqliteVersion: z.string().optional(),
  schemaVersion: z.number(),
  files: z.number(),
  sessions: z.number(),
  usageEvents: z.number(),
  /** Suma de `usage_events` (uso global sin duplicados). */
  usage: TokenUsageSchema,
  /** Sesiones sin prompts reales, que no salen en la lista. */
  hiddenSessions: z.number(),
  running: z.boolean(),
  lastPass: LastPassSchema.optional(),
  /** Vigilancia de la carpeta de Claude Code. */
  watch: z
    .object({
      state: z.enum(['watching', 'polling', 'off']),
      reason: z.string().optional(),
      lastEventAt: z.string().optional()
    })
    .optional(),
  /** Índice de búsqueda. */
  search: z.object({ messages: z.number() }).optional(),
  /** Progreso de una pasada larga en curso. */
  progress: z.object({ done: z.number(), total: z.number() }).optional()
})
export type IndexStatus = z.infer<typeof IndexStatusSchema>

export const IndexUpdatedSchema = z.object({ changed: z.boolean(), status: IndexStatusSchema })
export type IndexUpdated = z.infer<typeof IndexUpdatedSchema>
