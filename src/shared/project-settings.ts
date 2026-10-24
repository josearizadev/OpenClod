import { z } from 'zod'
import type { MessageKey } from './i18n'
import { SavedChatModeSchema } from './chat'

/**
 * Ajustes del proyecto: permisos, modo por defecto y coautoría de Git de los
 * archivos de ajustes de Claude Code, más Claude en Chrome (preferencia de la app). Solo se edita
 * el archivo personal del proyecto (`.claude/settings.local.json`).
 */

const RULES_MAX = 500
const RULE_MAX_LENGTH = 600

/** `Herramienta` o `Herramienta(patrón)`, como en los ajustes de Claude Code. */
const RULE_PATTERN = /^[A-Za-z0-9_*-]+(\(.+\))?$/s

const RuleSchema = z
  .string()
  .trim()
  .min(1)
  .max(RULE_MAX_LENGTH)
  .regex(RULE_PATTERN, { message: 'Formato: Herramienta o Herramienta(patrón)' })

export function isValidRule(rule: string): boolean {
  return RuleSchema.safeParse(rule).success
}

const RulesSchema = z.array(RuleSchema).max(RULES_MAX)

export type RuleKind = 'allow' | 'ask' | 'deny'

/** Lo que se lee de una capa de ajustes, solo con las claves de la lista blanca. */
export interface SettingsLayer {
  path: string
  exists: boolean
  /** El archivo no es JSON válido (o no es un objeto): no se escribe. */
  invalid?: true
  allow: string[]
  ask: string[]
  deny: string[]
  /** Tal cual está en el archivo; puede ser un modo que la app no ofrece. */
  defaultMode: string | null
  /** `false` = coautoría oculta, `true` = visible, `null` = no lo dice. */
  coAuthor: boolean | null
}

export interface ProjectSettings {
  /** Editable: `<proyecto>/.claude/settings.local.json`. */
  local: SettingsLayer & { hash: string | null }
  /** Compartido: `<proyecto>/.claude/settings.json` (solo lectura). */
  shared: SettingsLayer
  /** Del usuario: `<claudeDir>/settings.json` (solo lectura). */
  user: SettingsLayer
  /** Claude en Chrome en las sesiones del proyecto (preferencia de la app). */
  chrome: boolean
}

export type ProjectSettingsWrite =
  | { ok: true; settings: ProjectSettings }
  | { ok: false; reason: 'conflict'; settings: ProjectSettings }

const ProjectIdSchema = z.string().uuid()

export const ProjectSettingsReadInputSchema = z.object({ projectId: ProjectIdSchema }).strict()

export const ProjectSettingsWriteInputSchema = z
  .object({
    projectId: ProjectIdSchema,
    expectedHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    allow: RulesSchema,
    ask: RulesSchema,
    deny: RulesSchema,
    /** `undefined` = no tocar el que haya; `null` = quitarlo. */
    defaultMode: SavedChatModeSchema.nullable().optional(),
    /** `undefined` = no tocar. */
    coAuthor: z.boolean().optional()
  })
  .strict()
export type ProjectSettingsWriteInput = z.infer<typeof ProjectSettingsWriteInputSchema>
export type ProjectSettingsPatch = Omit<ProjectSettingsWriteInput, 'projectId' | 'expectedHash'>

export const ProjectChromeInputSchema = z
  .object({ projectId: ProjectIdSchema, enabled: z.boolean() })
  .strict()

/** Valor efectivo: el archivo personal manda sobre el compartido y este sobre el del usuario. */
export function effective<T>(
  settings: Pick<ProjectSettings, 'local' | 'shared' | 'user'>,
  pick: (layer: SettingsLayer) => T | null
): T | null {
  for (const layer of [settings.local, settings.shared, settings.user]) {
    const value = pick(layer)
    if (value !== null) return value
  }
  return null
}

// ---------------------------------------------------------------- accesos rápidos

export interface RulePreset {
  id: string
  /** Claves de traducción. */
  label: MessageKey
  hint: MessageKey
  rules: string[]
}

export const RULE_PRESETS: RulePreset[] = [
  {
    id: 'shell',
    label: 'Comandos de terminal',
    hint: 'Ejecutar cualquier comando (Bash y PowerShell) sin preguntar',
    rules: ['Bash', 'PowerShell']
  },
  {
    id: 'edit',
    label: 'Editar archivos',
    hint: 'Crear y modificar archivos del proyecto sin preguntar',
    rules: ['Edit', 'Write', 'NotebookEdit']
  },
  {
    id: 'web',
    label: 'Web',
    hint: 'Buscar en internet y descargar páginas sin preguntar',
    rules: ['WebSearch', 'WebFetch']
  }
]

// ---------------------------------------------------------------- Git

export type GitAction = 'commit' | 'push'
/** `inherit` = sin regla propia: deciden las demás reglas y el modo. */
export type GitRuleState = 'inherit' | 'ask' | 'allow' | 'deny'

function gitRules(action: GitAction): string[] {
  return [`Bash(git ${action} *)`, `PowerShell(git ${action} *)`]
}

/** Estado según las reglas: denegar manda sobre preguntar y este sobre permitir. */
export function gitRuleState(
  rules: Pick<SettingsLayer, 'allow' | 'ask' | 'deny'>,
  action: GitAction
): GitRuleState {
  const own = new Set(gitRules(action))
  if (rules.deny.some((r) => own.has(r))) return 'deny'
  if (rules.ask.some((r) => own.has(r))) return 'ask'
  if (rules.allow.some((r) => own.has(r))) return 'allow'
  return 'inherit'
}

/** Las reglas con las de `action` en la lista que toca (o en ninguna). */
export function withGitRule<T extends Pick<SettingsLayer, 'allow' | 'ask' | 'deny'>>(
  rules: T,
  action: GitAction,
  state: GitRuleState
): Pick<SettingsLayer, 'allow' | 'ask' | 'deny'> {
  const own = gitRules(action)
  const strip = (list: string[]): string[] => list.filter((r) => !own.includes(r))
  const out = { allow: strip(rules.allow), ask: strip(rules.ask), deny: strip(rules.deny) }
  if (state !== 'inherit') out[state].push(...own)
  return out
}
