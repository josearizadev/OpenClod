#!/usr/bin/env node
/**
 * Genera fixtures anonimizados de sesiones de Claude Code.
 *
 *   node scripts/anonimizar-fixture.mjs <origen projects/> <destino projects/> <proyecto>/<sessionId> [...]
 *
 * Copia el `.jsonl` principal y sus subagentes (`.jsonl` + `.meta.json`) conservando la estructura
 * y los campos que usa el parser, y sustituye todo texto libre por palabras de relleno. Solo LEE
 * del origen. Es determinista: el mismo origen da siempre el mismo resultado.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Claves cuyo valor de texto se conserva tal cual (identificadores, tipos, modelos, fechas…). */
const KEEP = new Set([
  'type',
  'uuid',
  'parentUuid',
  'leafUuid',
  'logicalParentUuid',
  'sessionId',
  'session_id',
  'id',
  'requestId',
  'timestamp',
  'model',
  'role',
  'stop_reason',
  'stop_sequence',
  'name',
  'subtype',
  'tool_use_id',
  'version',
  'entrypoint',
  'userType',
  'gitBranch',
  'agentId',
  'mode',
  'permissionMode',
  'operation',
  'level',
  'messageId',
  'snapshotMessageId',
  'promptId',
  'sourceToolAssistantUUID',
  'sourceToolUseID',
  'interruptedMessageId',
  'continuedInSessionId',
  'toolUseId',
  'agentType',
  'service_tier',
  'speed',
  'inference_geo',
  'sessionKind',
  'promptSource',
  'kind',
  'status',
  'media_type',
  'requestShape',
  'slug',
  'requestedModel',
  'advisorModel',
  'resolvedModel',
  'reason',
  'deliveryId',
  'commandUuid',
  'effort',
  'atis',
  'toolDenialKind',
  'turnOrigin',
  'turnPosition',
  'thinkingDisplay',
  // Avisos de límite: tipo de error y de ventana.
  'error',
  'apiError',
  'rateLimitType',
  'overageStatus',
  'overageDisabledReason'
])

/** Claves con rutas: se conserva la ruta salvo el nombre de usuario de Windows. */
const PATHS = new Set(['cwd', 'file_path', 'notebook_path', 'path', 'trackingPath'])

/** Etiquetas cuyo contenido se conserva (nombre del comando). */
const KEEP_TAG_CONTENT = new Set(['command-name', 'command-message'])

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const WORDS = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
  'enim'
]
const MAX_WORDS = 12

function anonPath(value) {
  return value.replace(/([\\/]Users[\\/])[^\\/]+/gi, '$1usuario')
}

/** Palabras de relleno con el mismo nº de palabras (hasta 12), deterministas por contenido. */
function filler(text) {
  const count = Math.min(text.trim().split(/\s+/).filter(Boolean).length, MAX_WORDS)
  if (count === 0) return text
  const hash = createHash('sha256').update(text).digest()
  const words = []
  for (let i = 0; i < count; i++) words.push(WORDS[hash[i % hash.length] % WORDS.length])
  return words.join(' ')
}

/**
 * Sustituye el texto libre conservando etiquetas (`<command-name>…`, `<local-command-stdout>`,
 * `<task-notification>`…) y marcas (`[Image #n]`, `[Request interrupted by user…]`).
 */
function anonText(text) {
  const parts = text.split(
    /(<\/?[a-zA-Z][\w-]*>|\[Image #\d+\]|\[Request interrupted by user[^\]]*\])/
  )
  let open = null
  return parts
    .map((part) => {
      const tag = /^<(\/?)([a-zA-Z][\w-]*)>$/.exec(part)
      if (tag) {
        open = tag[1] ? null : tag[2]
        return part
      }
      if (/^\[(Image #\d+|Request interrupted by user[^\]]*)\]$/.test(part)) return part
      if (open && KEEP_TAG_CONTENT.has(open)) return part
      return part.trim() ? filler(part) : part
    })
    .join('')
}

function walk(value, key) {
  if (typeof value === 'string') {
    if (key === 'data' || key === 'signature') return key === 'signature' ? 'sig' : ''
    if (KEEP.has(key)) return anonPath(value)
    if (PATHS.has(key)) return anonPath(value)
    return anonText(value)
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, key))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[anonPath(k)] = walk(v, k)
    return out
  }
  return value
}

function anonLine(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const copy = { ...obj }
  // Los adjuntos y bridge-session nunca salen del parser: no hace falta su contenido.
  if (copy.attachment && typeof copy.attachment === 'object') {
    copy.attachment = { type: copy.attachment.type }
  }
  if (copy.type === 'bridge-session') {
    for (const k of ['bridgeSessionId', 'ownerAccountUuid', 'ownerOrganizationUuid']) {
      if (k in copy) copy[k] = ZERO_UUID
    }
  }
  return walk(copy, '')
}

function anonJsonl(src, dest) {
  const lines = readFileSync(src, 'utf8').split('\n')
  const out = lines.map((line) => {
    if (!line.trim()) return line
    try {
      return JSON.stringify(anonLine(JSON.parse(line)))
    } catch {
      return '{"type":"linea-ilegible-en-origen"}'
    }
  })
  writeFileSync(dest, out.join('\n'), 'utf8')
}

function main() {
  const [srcRoot, destRoot, ...refs] = process.argv.slice(2)
  if (!srcRoot || !destRoot || refs.length === 0) {
    console.error(
      'Uso: anonimizar-fixture.mjs <origen projects/> <destino projects/> <proyecto>/<sessionId> [...]'
    )
    process.exit(1)
  }
  for (const ref of refs) {
    const [project, sessionId] = ref.split('/')
    const srcDir = join(srcRoot, project)
    const destDir = join(destRoot, project)
    mkdirSync(destDir, { recursive: true })
    anonJsonl(join(srcDir, `${sessionId}.jsonl`), join(destDir, `${sessionId}.jsonl`))
    const subSrc = join(srcDir, sessionId, 'subagents')
    if (existsSync(subSrc)) {
      const subDest = join(destDir, sessionId, 'subagents')
      mkdirSync(subDest, { recursive: true })
      for (const file of readdirSync(subSrc).sort()) {
        if (file.endsWith('.jsonl')) anonJsonl(join(subSrc, file), join(subDest, file))
        else if (file.endsWith('.meta.json')) {
          const meta = JSON.parse(readFileSync(join(subSrc, file), 'utf8'))
          writeFileSync(join(subDest, file), `${JSON.stringify(walk(meta, ''))}\n`, 'utf8')
        }
      }
    }
    console.log(`OK ${ref}`)
  }
}

main()
