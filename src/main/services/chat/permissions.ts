import type {
  PermissionMode,
  PermissionResult,
  PermissionUpdate
} from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import {
  MODE_LABELS,
  type ChatMode,
  type ChatPermissionInput,
  type PermissionDecision,
  type PermissionKind,
  type PermissionRequestView
} from '../../../shared/chat'

/**
 * Peticiones de permiso de una sesión de chat. `canUseTool` abre una
 * petición con un id aleatorio propio y espera, sin límite de tiempo, a que el usuario
 * responda desde la tarjeta. La app nunca aprueba por su cuenta y «Permitir siempre» nunca
 * escribe en los ajustes de usuario ni de proyecto compartido (pregunta abierta 1).
 */

type Obj = Record<string, unknown>

export interface CanUseToolOptions {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  decisionReason?: string
  title?: string
  displayName?: string
  description?: string
  toolUseID: string
  suppressAlwaysAllowRule?: boolean
}

export interface PermissionHooks {
  onRequest(view: PermissionRequestView): void
  onResolved(view: PermissionRequestView, decision: PermissionDecision): void
  /** El modo de la sesión cambia por la respuesta (sugerencia `setMode`, plan aprobado). */
  onModeChange?(mode: ChatMode): void
  log?: (message: string) => void
}

interface Pending {
  view: PermissionRequestView
  input: Obj
  suggestions: PermissionUpdate[]
  resolve: (result: PermissionResult) => void
  cleanup: () => void
}

const KNOWN_MODES = new Set<string>(['default', 'acceptEdits', 'plan', 'bypassPermissions'])

function kindOf(toolName: string): PermissionKind {
  if (toolName === 'AskUserQuestion') return 'question'
  if (toolName === 'ExitPlanMode') return 'plan'
  return 'tool'
}

function modeLabel(mode: PermissionMode): string {
  return KNOWN_MODES.has(mode) ? MODE_LABELS[mode as ChatMode] : mode
}

/** Texto de lo que añadiría cada sugerencia, para la tarjeta. */
export function suggestionLabels(suggestions: readonly PermissionUpdate[]): string[] {
  const out: string[] = []
  for (const s of suggestions) {
    if (s.type === 'addRules' || s.type === 'replaceRules') {
      for (const rule of s.rules)
        out.push(rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName)
    } else if (s.type === 'setMode') {
      out.push(`modo ${modeLabel(s.mode)}`)
    } else if (s.type === 'addDirectories') {
      for (const dir of s.directories) out.push(`acceso a ${dir}`)
    }
  }
  return out
}

/**
 * Sugerencias con el destino que eligió el usuario: `session` (no escribe nada) o `localSettings`
 * (`<proyecto>/.claude/settings.local.json`, lo escribe Claude Code). El cambio de modo es siempre
 * de la sesión. Nunca `userSettings` ni `projectSettings`.
 */
export function rewriteSuggestions(
  suggestions: readonly PermissionUpdate[],
  scope: 'session' | 'project'
): PermissionUpdate[] {
  return suggestions
    .filter((s) => s.type !== 'removeRules' && s.type !== 'removeDirectories')
    .map((s) => ({
      ...s,
      destination: s.type === 'setMode' || scope === 'session' ? 'session' : 'localSettings'
    }))
}

export class PermissionBroker {
  private readonly pending = new Map<string, Pending>()
  /** Decisión de cada llamada resuelta, por `toolUseId`. */
  readonly decisions: Record<string, PermissionDecision> = {}

  constructor(private readonly hooks: PermissionHooks) {}

  /** Peticiones pendientes, en el orden en que llegaron. */
  list(): PermissionRequestView[] {
    return [...this.pending.values()].map((p) => p.view)
  }

  get size(): number {
    return this.pending.size
  }

  readonly canUseTool = (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions
  ): Promise<PermissionResult> => {
    const suggestions = options.suggestions ?? []
    const kind = kindOf(toolName)
    const view: PermissionRequestView = {
      requestId: randomUUID(),
      ...(options.toolUseID ? { toolUseId: options.toolUseID } : {}),
      toolName,
      input,
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.decisionReason ? { decisionReason: options.decisionReason } : {}),
      ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
      alwaysLabels: kind === 'tool' ? suggestionLabels(suggestions) : [],
      kind,
      ...(options.suppressAlwaysAllowRule || kind !== 'tool' ? { noAlways: true as const } : {}),
      createdAt: new Date().toISOString()
    }

    return new Promise<PermissionResult>((resolve) => {
      if (options.signal.aborted) {
        resolve({ behavior: 'deny', message: 'Cancelado' })
        return
      }
      const onAbort = (): void =>
        this.finish(view.requestId, 'cancelled', {
          behavior: 'deny',
          message: 'El usuario ha detenido el turno.'
        })
      options.signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(view.requestId, {
        view,
        input,
        suggestions,
        resolve,
        cleanup: () => options.signal.removeEventListener('abort', onAbort)
      })
      this.hooks.onRequest(view)
    })
  }

  /**
   * Respuesta del usuario. Solo vale para una petición pendiente y una sola vez: un id
   * desconocido o ya resuelto se ignora y devuelve `false`.
   */
  respond(answer: Omit<ChatPermissionInput, 'sessionId'>): boolean {
    const entry = this.pending.get(answer.requestId)
    if (!entry) {
      this.hooks.log?.('Respuesta de permiso ignorada: petición desconocida o ya resuelta')
      return false
    }
    const { view, input, suggestions } = entry

    if (view.kind === 'question') {
      const answers = answer.answers ?? {}
      if (answer.decision === 'deny' || Object.keys(answers).length === 0) {
        this.finish(view.requestId, 'denied', {
          behavior: 'deny',
          message: answer.message?.trim() || 'El usuario no ha querido responder.'
        })
      } else {
        this.finish(view.requestId, 'allowed', {
          behavior: 'allow',
          updatedInput: { ...input, answers }
        })
      }
      return true
    }

    if (view.kind === 'plan') {
      if (answer.decision === 'deny') {
        this.finish(view.requestId, 'denied', {
          behavior: 'deny',
          message: answer.message?.trim() || 'El usuario quiere seguir planificando.'
        })
      } else {
        const setMode = suggestions.filter((s) => s.type === 'setMode')
        this.finish(view.requestId, 'allowed', {
          behavior: 'allow',
          updatedInput: input,
          ...(setMode.length ? { updatedPermissions: rewriteSuggestions(setMode, 'session') } : {})
        })
        const mode = setMode[0]?.type === 'setMode' ? setMode[0].mode : 'default'
        if (KNOWN_MODES.has(mode)) this.hooks.onModeChange?.(mode as ChatMode)
      }
      return true
    }

    if (answer.decision === 'deny') {
      this.finish(view.requestId, 'denied', {
        behavior: 'deny',
        message: answer.message?.trim() || 'El usuario ha denegado el permiso.'
      })
      return true
    }
    if (answer.decision === 'always' && !view.noAlways && suggestions.length > 0) {
      const updates = rewriteSuggestions(suggestions, answer.scope ?? 'session')
      this.finish(view.requestId, 'always', {
        behavior: 'allow',
        updatedInput: input,
        updatedPermissions: updates
      })
      for (const update of updates) {
        if (update.type === 'setMode' && KNOWN_MODES.has(update.mode))
          this.hooks.onModeChange?.(update.mode as ChatMode)
      }
      return true
    }
    this.finish(view.requestId, 'allowed', { behavior: 'allow', updatedInput: input })
    return true
  }

  /** Deniega todo lo pendiente y deja las tarjetas como «Cancelado». */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.finish(id, 'cancelled', {
        behavior: 'deny',
        message: 'El usuario ha detenido el turno.'
      })
    }
  }

  private finish(requestId: string, decision: PermissionDecision, result: PermissionResult): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    entry.cleanup()
    if (entry.view.toolUseId) this.decisions[entry.view.toolUseId] = decision
    entry.resolve(result)
    this.hooks.onResolved(entry.view, decision)
  }
}
