import { z } from 'zod'

/**
 * Búsqueda global. Esquemas del canal `search:query` y normalización
 * compartida por el main (títulos), la búsqueda en la sesión y el resaltado del renderer.
 */
export const SearchScopeSchema = z.enum(['project', 'all'])
export type SearchScope = z.infer<typeof SearchScopeSchema>
export const SearchAuthorSchema = z.enum(['all', 'user', 'assistant'])
export type SearchAuthor = z.infer<typeof SearchAuthorSchema>
export const SearchSortSchema = z.enum(['relevance', 'date'])
export type SearchSort = z.infer<typeof SearchSortSchema>

export const SearchQuerySchema = z
  .object({
    text: z.string().max(500),
    scope: SearchScopeSchema,
    projectId: z.string().uuid().optional(),
    author: SearchAuthorSchema,
    sort: SearchSortSchema,
    includeHidden: z.boolean(),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict()
export type SearchQuery = z.input<typeof SearchQuerySchema>

/** Trozo de un fragmento: el renderer nunca recibe HTML. */
export interface SnippetPart {
  text: string
  match: boolean
}

export interface SearchHit {
  uuid: string
  /** Sesión que contiene la línea. */
  sessionId: string
  role: 'user' | 'assistant'
  timestamp?: string
  snippet: SnippetPart[]
}

export interface SearchGroup {
  /** Entrada de la conversación en la lista (su última sesión). */
  entryId: string
  title: string
  projectName?: string
  updatedAt?: string
  titleMatch: SnippetPart[] | null
  hitCount: number
  /** Los 3 mejores. */
  hits: SearchHit[]
}

export interface SearchResult {
  groups: SearchGroup[]
  total: number
  /** La consulta se buscó como frase literal (comillas sin cerrar o solo signos). */
  literal: boolean
  /** Pasada larga en curso: resultados parciales. */
  indexing: { done: number; total: number } | null
  durationMs: number
  /** Términos normalizados para resaltar. */
  terms: string[]
}

/** Minúsculas y sin marcas diacríticas (NFD sin `\p{M}`). */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Normaliza guardando, para cada carácter del resultado, su posición en el original: las tildes
 * descompuestas cambian longitudes.
 */
export function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) as number
    const ch = String.fromCodePoint(cp)
    const norm = normalizeForSearch(ch)
    for (let k = 0; k < norm.length; k++) map.push(i)
    out += norm
    i += ch.length
  }
  map.push(text.length)
  return { text: out, map }
}

/** Parte `text` en trozos marcando las apariciones de los términos (ya normalizados). */
export function splitMatches(text: string, terms: readonly string[]): SnippetPart[] {
  const usable = terms.filter((t) => t.length > 0)
  if (usable.length === 0 || !text) return [{ text, match: false }]
  const { text: norm, map } = normalizeWithMap(text)
  const ranges: [number, number][] = []
  for (const term of usable) {
    for (let at = norm.indexOf(term); at !== -1; at = norm.indexOf(term, at + term.length)) {
      ranges.push([map[at] as number, map[at + term.length] as number])
    }
  }
  if (ranges.length === 0) return [{ text, match: false }]
  ranges.sort((a, b) => a[0] - b[0])
  const parts: SnippetPart[] = []
  let pos = 0
  for (const [start, end] of ranges) {
    if (end <= pos) continue
    const from = Math.max(start, pos)
    if (from > pos) parts.push({ text: text.slice(pos, from), match: false })
    parts.push({ text: text.slice(from, end), match: true })
    pos = end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false })
  return parts
}
