import { normalizeForSearch } from '../../../../shared/search'
import type { TranscriptItem } from '../../../../shared/sessions'

/**
 * Búsqueda en la sesión abierta. Pura, sobre **todos** los
 * elementos (también los ocultos por filtros o no montados): prompts, respuestas, thinking y la
 * salida visible de las herramientas. La entrada de las herramientas no cuenta.
 */
export type FindField = 'prompt' | 'text' | 'thinking' | 'tool-output'

export interface FindHit {
  /** Posición del elemento en la lista. */
  index: number
  uuid?: string
  toolUseId?: string
  field: FindField
  /** Orden de la aparición dentro del elemento. */
  ordinal: number
}

/** Texto normalizado por elemento: los elementos no cambian, así recalcular es solo `indexOf`. */
const normalized = new WeakMap<TranscriptItem, string>()

function fieldOf(item: TranscriptItem): { field: FindField; text: string } | null {
  switch (item.kind) {
    case 'user-prompt':
      return { field: 'prompt', text: item.text }
    case 'assistant-text':
      return { field: 'text', text: item.text }
    case 'thinking':
      return { field: 'thinking', text: item.text }
    case 'tool-result':
      return { field: 'tool-output', text: item.text }
    default:
      return null
  }
}

export function findInItems(items: readonly TranscriptItem[], query: string): FindHit[] {
  const term = normalizeForSearch(query.trim())
  if (!term) return []
  const hits: FindHit[] = []
  items.forEach((item, index) => {
    const found = fieldOf(item)
    if (!found || !found.text) return
    let text = normalized.get(item)
    if (text === undefined) {
      text = normalizeForSearch(found.text)
      normalized.set(item, text)
    }
    let ordinal = 0
    for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
      hits.push({
        index,
        ...(item.uuid ? { uuid: item.uuid } : {}),
        ...(item.kind === 'tool-result' ? { toolUseId: item.toolUseId } : {}),
        field: found.field,
        ordinal: ordinal++
      })
    }
  })
  return hits
}

/** Identidad estable de una aparición: sobrevive a que lleguen elementos nuevos. */
export function hitId(hit: FindHit): string {
  return `${hit.uuid ?? `i${hit.index}`}#${hit.ordinal}`
}
