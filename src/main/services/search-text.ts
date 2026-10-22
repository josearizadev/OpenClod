import type { TranscriptItem } from '../../shared/sessions'

/**
 * Qué texto de un elemento entra en el índice de búsqueda:
 * solo los prompts reales y las respuestas del asistente del hilo principal. Nunca thinking,
 * herramientas, comandos, avisos internos ni adjuntos. Puro.
 */
export const MAX_SEARCH_TEXT = 32_000

export interface SearchText {
  uuid: string
  role: 'user' | 'assistant'
  timestamp?: string
  line: number
  text: string
}

export function searchTextOf(item: TranscriptItem): SearchText | null {
  if (item.sidechain || !item.uuid) return null
  let role: SearchText['role']
  if (item.kind === 'user-prompt') role = 'user'
  else if (item.kind === 'assistant-text') role = 'assistant'
  else return null
  const text = item.text.trim()
  if (!text) return null
  return {
    uuid: item.uuid,
    role,
    ...(item.timestamp ? { timestamp: item.timestamp } : {}),
    line: item.line,
    text: text.length > MAX_SEARCH_TEXT ? text.slice(0, MAX_SEARCH_TEXT) : text
  }
}
