import type Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { openIndex } from '../../src/main/services/index-schema'
import { runPass } from '../../src/main/services/indexer'
import { compileQuery, search, snippetParts } from '../../src/main/services/search-query'
import { normalizeForSearch, splitMatches, type SearchQuery } from '../../src/shared/search'
import type { Project, SessionMeta } from '../../src/shared/types'

const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }

describe('compileQuery', () => {
  it.each([
    ['indice busqueda', '"indice" "busqueda"*', false],
    ['"modo oscuro" tema', '"modo oscuro" "tema"*', false],
    ['"modo oscuro"', '"modo oscuro"', false],
    ['fs.watch', '"fs.watch"*', false],
    ['`runPass()`', '"`runPass()`"*', false],
    ['"sin cerrar', '"sin cerrar"', true],
    ['hola -> mundo', '"hola" "mundo"*', true]
  ])('%s → %s', (text, match, literal) => {
    expect(compileQuery(text)).toMatchObject({ match, literal })
  })

  it('sin tokens o vacía → null', () => {
    expect(compileQuery('"..."')).toBeNull()
    expect(compileQuery('  ')).toBeNull()
    expect(compileQuery('-> ()')).toBeNull()
  })

  it('escapa comillas internas: nunca sintaxis FTS del usuario', () => {
    expect(compileQuery('a"b"c')?.match).toBe('"a""b""c"*')
    expect(compileQuery('NEAR(x y) OR z')?.match).toBe('"NEAR(x" "y)" "OR" "z"*')
  })
})

describe('fragmentos', () => {
  it('snippetParts parte por las marcas de uso privado', () => {
    expect(snippetParts('…la \uE000búsqueda\uE001 global')).toEqual([
      { text: '…la ', match: false },
      { text: 'búsqueda', match: true },
      { text: ' global', match: false }
    ])
  })

  it('splitMatches respeta tildes descompuestas', () => {
    const text = 'Indexación y busque\u0301da'
    expect(splitMatches(text, ['busqueda']).filter((p) => p.match)).toEqual([
      { text: 'busque\u0301da', match: true }
    ])
    expect(normalizeForSearch('ÍNDICE')).toBe('indice')
  })
})

// --- Búsqueda sobre un índice real de sesiones sintéticas -------------------------------------

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const HIDDEN = '00000000-0000-4000-8000-00000000000d'

const user = (uuid: string, text: string, cwd: string, ts: string): Record<string, unknown> => ({
  type: 'user',
  uuid,
  timestamp: ts,
  cwd,
  message: { role: 'user', content: text }
})
const assistant = (
  uuid: string,
  text: string,
  cwd: string,
  ts: string
): Record<string, unknown> => ({
  type: 'assistant',
  uuid,
  timestamp: ts,
  cwd,
  requestId: `req-${uuid}`,
  message: {
    id: `msg-${uuid}`,
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 }
  }
})

const projects: Project[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    path: 'Z:\\web\\uno',
    name: 'uno',
    addedAt: '',
    lastOpenedAt: ''
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    path: 'Z:\\web\\dos',
    name: 'dos',
    addedAt: '',
    lastOpenedAt: ''
  }
]
let db: Database.Database
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'bitacora-search-'))
  const write = (folder: string, id: string, lines: Record<string, unknown>[]): void => {
    const dir = join(root, 'claude', 'projects', folder)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l) + '\n').join(''))
  }
  const uno = 'Z:\\web\\uno'
  const dos = 'Z:\\web\\dos'
  const first = [
    user('a1', 'Explícame la búsqueda del índice', uno, '2026-10-01T10:00:00Z'),
    assistant('a2', 'La búsqueda usa FTS5 con runPass()', uno, '2026-10-01T10:00:05Z')
  ]
  // A continúa en B: B copia las líneas de A (lo heredado se cuenta una vez).
  write('Z--web-uno', A, [
    ...first,
    {
      type: 'continued-in',
      timestamp: '2026-10-01T10:01:00Z',
      sessionId: A,
      continuedInSessionId: B
    }
  ])
  write('Z--web-uno', B, [
    ...first,
    user('b1', 'Ahora el modo oscuro', uno, '2026-10-02T10:00:00Z'),
    assistant('b2', 'Hecho: modo oscuro con tokens', uno, '2026-10-02T10:00:05Z')
  ])
  write('Z--web-dos', C, [
    user('c1', 'Configura fs.watch para la búsqueda', dos, '2026-10-03T10:00:00Z'),
    assistant('c2', 'Uso <b>chokidar</b> en lugar de fs.watch', dos, '2026-10-03T10:00:05Z')
  ])
  write('Z--web-dos', HIDDEN, [
    user('d1', 'Búsqueda secreta', dos, '2026-10-04T10:00:00Z'),
    assistant('d2', 'Vale', dos, '2026-10-04T10:00:05Z')
  ])
  const opened = openIndex(join(root, 'bitacora.db'), quiet)
  if (!opened.ok) throw new Error(opened.error)
  db = opened.db
  await runPass(db, join(root, 'claude'), quiet)
})

const meta: Record<string, SessionMeta> = {
  [HIDDEN]: { hidden: true, updatedAt: '' },
  [C]: { title: 'Vigilancia con chokidar', updatedAt: '' }
}

function run(text: string, extra: Partial<SearchQuery> = {}): ReturnType<typeof search> {
  return search(
    db,
    { projects, sessionMeta: meta },
    { text, scope: 'all', author: 'all', sort: 'relevance', includeHidden: false, ...extra }
  )
}

describe('search', () => {
  it('sin tildes encuentra con tildes; lo heredado se cuenta una vez', () => {
    const result = run('busqueda')
    const ids = result.groups.map((g) => g.entryId)
    expect(ids).toContain(B)
    expect(ids).not.toContain(A)
    const chain = result.groups.find((g) => g.entryId === B)
    expect(chain?.hitCount).toBe(2)
    expect(chain?.projectName).toBe('uno')
    // Oculta fuera; con includeHidden, dentro.
    expect(ids).not.toContain(HIDDEN)
    expect(run('busqueda', { includeHidden: true }).groups.map((g) => g.entryId)).toContain(HIDDEN)
  })

  it('autor y ámbito', () => {
    expect(run('fs.watch', { author: 'user' }).total).toBe(1)
    expect(run('fs.watch', { author: 'assistant' }).groups[0]?.hits[0]?.role).toBe('assistant')
    const scoped = run('busqueda', { scope: 'project', projectId: projects[1]?.id })
    expect(scoped.groups.map((g) => g.entryId)).toEqual([C])
    expect(scoped.groups[0]?.projectName).toBeUndefined()
  })

  it('prefijo, frases y código', () => {
    expect(run('indi').total).toBeGreaterThan(0)
    expect(run('"modo oscuro"').groups.map((g) => g.entryId)).toEqual([B])
    expect(run('`runPass()`').total).toBe(1)
    expect(run('"oscuro modo"').total).toBe(0)
  })

  it('títulos propios cuentan y suben al principio', () => {
    const result = run('vigilancia')
    expect(result.groups[0]?.entryId).toBe(C)
    expect(result.groups[0]?.titleMatch?.some((p) => p.match)).toBe(true)
    expect(result.groups[0]?.hitCount).toBe(0)
  })

  it('fragmentos como texto, nunca HTML; consultas raras no fallan', () => {
    const hit = run('chokidar').groups[0]?.hits[0]
    const joined = hit?.snippet.map((p) => p.text).join('')
    expect(joined).toContain('<b>')
    expect(hit?.snippet.some((p) => p.match && normalizeForSearch(p.text) === 'chokidar')).toBe(
      true
    )
    expect(run('"...').groups).toEqual([])
    expect(run('NEAR(').total).toBe(0)
    expect(run('-> ()').literal).toBe(true)
  })

  it('orden por fecha', () => {
    const result = run('busqueda', { sort: 'date' })
    expect(result.groups.map((g) => g.entryId)).toEqual([C, B])
  })
})

process.on('exit', () => {
  try {
    db?.close()
    rmSync(root, { recursive: true, force: true })
  } catch {
    // Limpieza.
  }
})
