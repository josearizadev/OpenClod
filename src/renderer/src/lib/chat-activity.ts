import type { ChatActivity, ChatDraft, ChatStatus } from '../../../shared/chat'
import type { TranscriptItem } from '../../../shared/sessions'
import { toolCategory, toolSummary, type ToolCategory } from './transcript/tools'
import { t } from '../i18n'

/**
 * Qué está haciendo Claude ahora mismo: «Pensando…», «Ejecutando npm test»,
 * «Escribiendo…». Pura: sale del estado de la sesión de chat.
 */

const GERUNDS: Record<ToolCategory, string> = {
  read: t('Leyendo'),
  search: t('Buscando'),
  edit: t('Editando'),
  write: t('Escribiendo'),
  run: t('Ejecutando'),
  web: t('Consultando'),
  agent: t('Subagente:'),
  other: t('Usando')
}

/** Longitud máxima del argumento: la etiqueta va en una línea. */
const MAX = 60

export interface ActivityInput {
  status: ChatStatus
  activity: ChatActivity | null
  live: readonly TranscriptItem[]
  draft: ChatDraft | null
  cwd?: string
}

/** Última llamada en vivo sin resultado, o `null`. */
function runningTool(
  live: readonly TranscriptItem[]
): Extract<TranscriptItem, { kind: 'tool-use' }> | null {
  const done = new Set<string>()
  for (let i = live.length - 1; i >= 0; i--) {
    const item = live[i] as TranscriptItem
    if (item.kind === 'tool-result') done.add(item.toolUseId)
    else if (item.kind === 'tool-use' && !done.has(item.id)) return item
    // Lo anterior a un prompt o a un texto ya no está en curso.
    else if (item.kind === 'user-prompt' || item.kind === 'assistant-text') return null
  }
  return null
}

function toolLabel(name: string, input: unknown, cwd: string | undefined): string {
  const category = toolCategory(name)
  let summary = toolSummary(name, input, cwd)
  if (summary.length > MAX) summary = `${summary.slice(0, MAX - 1)}…`
  if (category === 'other') return `${t('Usando')} ${name}${summary ? ` · ${summary}` : ''}`
  return summary ? `${GERUNDS[category]} ${summary}` : `${GERUNDS[category]}…`
}

/** Etiqueta del estado, o `null` si la sesión no trabaja. */
export function activityLabel(input: ActivityInput): string | null {
  switch (input.status) {
    case 'starting':
      return t('Iniciando…')
    case 'waiting':
      return t('Esperando permiso')
    case 'working':
      break
    default:
      return null
  }
  if (input.draft?.text.trim()) return t('Escribiendo…')
  const tool = runningTool(input.live)
  if (tool) return toolLabel(tool.name, tool.input, input.cwd)
  switch (input.activity) {
    case 'thinking':
      return t('Pensando…')
    case 'writing':
      return t('Escribiendo…')
    case 'tool':
      return t('Preparando una herramienta…')
    default:
      return t('Trabajando…')
  }
}
