import type Database from 'better-sqlite3'
import type { Project, SessionMeta } from '../../shared/types'
import {
  normalizeForSearch,
  splitMatches,
  SearchQuerySchema,
  type SearchGroup,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
  type SnippetPart
} from '../../shared/search'
import { IS_ENTRY } from './index-queries'
import { pathKey } from './paths'

/**
 * Búsqueda global sobre el índice de texto. Solo lectura con el lector del
 * main. La cadena `MATCH` se construye con frases entre comillas escapadas: nunca se pasa el texto
 * del usuario como sintaxis FTS5.
 */

export interface CompiledQuery {
  match: string
  /** Términos normalizados, para resaltar títulos y coincidencias. */
  terms: string[]
  literal: boolean
}

const HAS_TOKEN = /[\p{L}\p{N}]/u
const OPEN = ''
const CLOSE = ''

function phrase(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

export function compileQuery(text: string): CompiledQuery | null {
  const source = text.trim()
  if (!source) return null
  const quotes = (source.match(/"/g) ?? []).length
  if (quotes % 2 === 1) {
    // Comillas sin cerrar: todo el texto, sin comillas, como una frase literal.
    const plain = source.replace(/"/g, ' ').trim()
    if (!HAS_TOKEN.test(plain)) return null
    return { match: phrase(plain), terms: [normalizeForSearch(plain)], literal: true }
  }

  const parts: { text: string; quoted: boolean }[] = []
  const re = /"([^"]*)"|(\S+)/g
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m[1] !== undefined) parts.push({ text: m[1].trim(), quoted: true })
    else if (m[2]) parts.push({ text: m[2], quoted: false })
  }
  const usable = parts.filter((p) => HAS_TOKEN.test(p.text))
  if (usable.length === 0) return null
  const last = usable.length - 1
  const match = usable
    .map((p, i) => (i === last && !p.quoted ? `${phrase(p.text)}*` : phrase(p.text)))
    .join(' ')
  return {
    match,
    terms: usable.map((p) => normalizeForSearch(p.text)),
    literal: usable.length < parts.length
  }
}

/** Trozos de un fragmento de `snippet()` con las marcas de uso privado. */
export function snippetParts(snip: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let match = false
  let buffer = ''
  for (const ch of snip) {
    if (ch === OPEN || ch === CLOSE) {
      if (buffer) parts.push({ text: buffer, match })
      buffer = ''
      match = ch === OPEN
    } else buffer += ch
  }
  if (buffer) parts.push({ text: buffer, match })
  return parts
}

export interface SearchContext {
  projects: readonly Project[]
  sessionMeta: Readonly<Record<string, SessionMeta>>
  progress?: { done: number; total: number } | null
  log?: { info(scope: string, message: string): void }
}

interface HitRow {
  id: number
  session_id: string
  uuid: string
  role: 'user' | 'assistant'
  timestamp: string | null
  rank: number
  snip: string
  conversation_id: string
}

interface EntryRow {
  session_id: string
  conversation_id: string
  title: string
  updated_at: string | null
  project_key: string | null
}

const HITS_SQL = `
WITH hits AS (
  SELECT m.id, m.session_id, m.uuid, m.role, m.timestamp, bm25(messages_fts) AS rank,
         snippet(messages_fts, 0, char(57344), char(57345), '…', 12) AS snip,
         s.conversation_id
  FROM messages_fts JOIN message_text m ON m.id = messages_fts.rowid
  JOIN sessions s ON s.session_id = m.session_id
  WHERE messages_fts MATCH @match AND (@role IS NULL OR m.role = @role)
    AND (@projectKey IS NULL OR s.project_key = @projectKey)
)
SELECT * FROM hits WHERE id IN (SELECT min(id) FROM hits GROUP BY conversation_id, uuid)
ORDER BY rank LIMIT 2000`

const ENTRIES_SQL = `
SELECT s.session_id, s.conversation_id, s.title, s.updated_at, s.project_key
FROM sessions s
WHERE ${IS_ENTRY} AND (@projectKey IS NULL OR s.project_key = @projectKey)
ORDER BY s.updated_at DESC`

interface Acc {
  group: SearchGroup
  best: number
  titleHit: boolean
}

function empty(literal: boolean, started: number, ctx: SearchContext): SearchResult {
  return {
    groups: [],
    total: 0,
    literal,
    indexing: ctx.progress ?? null,
    durationMs: Math.round(performance.now() - started),
    terms: []
  }
}

export function search(db: Database.Database, ctx: SearchContext, raw: SearchQuery): SearchResult {
  const started = performance.now()
  const query = SearchQuerySchema.parse(raw)
  const compiled = compileQuery(query.text)
  if (!compiled) return empty(/[^\s"]/.test(query.text), started, ctx)

  const project =
    query.scope === 'project' && query.projectId
      ? ctx.projects.find((p) => p.id === query.projectId)
      : undefined
  const projectKey = project ? pathKey(project.path) : null
  const role = query.author === 'all' ? null : query.author

  let rows: HitRow[]
  try {
    rows = db.prepare<unknown[], HitRow>(HITS_SQL).all({ match: compiled.match, role, projectKey })
  } catch {
    // Defensa: una frase entre comillas no debería fallar, pero el error nunca llega al usuario.
    return empty(true, started, ctx)
  }

  // Entrada de cada conversación (la más reciente) y nombres de proyecto.
  const entries = new Map<string, EntryRow>()
  for (const e of db.prepare<unknown[], EntryRow>(ENTRIES_SQL).all({ projectKey })) {
    if (!entries.has(e.conversation_id)) entries.set(e.conversation_id, e)
  }
  const projectNames = new Map(ctx.projects.map((p) => [pathKey(p.path), p.name]))

  const groups = new Map<string, Acc>()
  function groupOf(conversationId: string): Acc | null {
    const existing = groups.get(conversationId)
    if (existing) return existing
    const entry = entries.get(conversationId)
    const meta = ctx.sessionMeta[conversationId]
    if (!entry || (!query.includeHidden && meta?.hidden === true)) return null
    const title = meta?.title ?? entry.title
    const normTitle = normalizeForSearch(title)
    const titleHit = (compiled as CompiledQuery).terms.every((t) => normTitle.includes(t))
    const projectName = entry.project_key ? projectNames.get(entry.project_key) : undefined
    const acc: Acc = {
      group: {
        entryId: entry.session_id,
        title,
        ...(query.scope === 'all' && projectName ? { projectName } : {}),
        ...(entry.updated_at ? { updatedAt: entry.updated_at } : {}),
        titleMatch: titleHit ? splitMatches(title, (compiled as CompiledQuery).terms) : null,
        hitCount: 0,
        hits: []
      },
      best: Number.POSITIVE_INFINITY,
      titleHit
    }
    groups.set(conversationId, acc)
    return acc
  }

  let total = 0
  for (const row of rows) {
    const acc = groupOf(row.conversation_id)
    if (!acc) continue
    total++
    acc.group.hitCount++
    acc.best = Math.min(acc.best, row.rank)
    if (acc.group.hits.length < 3) {
      const hit: SearchHit = {
        uuid: row.uuid,
        sessionId: row.session_id,
        role: row.role,
        ...(row.timestamp ? { timestamp: row.timestamp } : {}),
        snippet: snippetParts(row.snip)
      }
      acc.group.hits.push(hit)
    }
  }
  // Conversaciones que solo coinciden por el título.
  for (const conversationId of entries.keys()) {
    if (groups.has(conversationId)) continue
    const acc = groupOf(conversationId)
    if (acc && !acc.titleHit) groups.delete(conversationId)
  }

  const list = [...groups.values()]
  if (query.sort === 'date') {
    list.sort((a, b) => (b.group.updatedAt ?? '').localeCompare(a.group.updatedAt ?? ''))
  } else {
    list.sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || a.best - b.best)
  }
  const result: SearchResult = {
    groups: list.slice(0, query.limit).map((a) => a.group),
    total,
    literal: compiled.literal,
    indexing: ctx.progress ?? null,
    durationMs: Math.round(performance.now() - started),
    terms: compiled.terms
  }
  ctx.log?.info(
    'search',
    `Búsqueda en ${result.durationMs} ms · ${total} coincidencias · ${list.length} conversaciones`
  )
  return result
}
