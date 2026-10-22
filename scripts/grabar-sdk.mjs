#!/usr/bin/env node
/**
 * Graba fixtures reales del Agent SDK para los tests del chat.
 *
 *   node scripts/grabar-sdk.mjs <carpeta temporal> [caso ...]
 *
 * Para cada caso lanza `query()` con entrada en streaming en `<carpeta temporal>/<caso>`, con un
 * guion que responde a los permisos, encola mensajes, detiene tareas o interrumpe, y guarda:
 *   - `tests/fixtures/sdk/chat-<caso>.jsonl`: cada mensaje del SDK, más líneas `_bitacora` con lo
 *     que hizo el guion (envíos, peticiones de permiso y sus respuestas, stopTask, interrupt);
 *   - `tests/fixtures/sdk/chat-<caso>.disco/`: el JSONL (y subagentes) que escribió Claude Code.
 * Todo anonimizado: nombre de usuario, correo e ids de cuenta u organización.
 *
 * Herramienta de desarrollo: no se empaqueta. Usa Haiku y nunca un proyecto del usuario. Solo LEE
 * de la carpeta de Claude Code (la sesión la escribe el propio Claude Code).
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'tests/fixtures/sdk')
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const MODEL = process.env.GRABAR_MODELO || 'haiku'
const TIMEOUT_MS = 240_000

// ---------------------------------------------------------------- anonimización

const USER = userInfo().username
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const ACCOUNT_KEYS = /organization|account|org_?id|user_?id|email/i

function anonValue(value, key) {
  if (typeof value === 'string') {
    if (key && ACCOUNT_KEYS.test(key))
      return /^[0-9a-f-]{36}$/i.test(value) ? ZERO_UUID : 'anonimizado'
    return value
  }
  if (Array.isArray(value)) return value.map((item) => anonValue(item, key))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = anonValue(v, k)
    return out
  }
  return value
}

function anonString(text) {
  let out = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'usuario@example.com')
  if (USER)
    out = out.replace(new RegExp(USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'usuario')
  // Conectores de claude.ai del usuario (nombres de servicios que tiene enlazados).
  out = out.replace(/claude\.ai [A-Za-z][A-Za-z ]*[A-Za-z]/g, 'claude.ai Conector')
  return out.replace(/("messaging_socket_path":")[^"]*"/, '$1anonimizado"')
}

const anonLine = (obj) => anonString(JSON.stringify(anonValue(obj, '')))

function anonFile(src, dest) {
  const lines = readFileSync(src, 'utf8').split('\n')
  const out = lines.map((line) => {
    if (!line.trim()) return line
    try {
      return anonLine(JSON.parse(line))
    } catch {
      return '{"type":"linea-ilegible-en-origen"}'
    }
  })
  writeFileSync(dest, out.join('\n'), 'utf8')
}

/** Copia anonimizada del JSONL de la sesión (y sus subagentes) que escribió Claude Code. */
function copyDisk(sessionId, dest) {
  const projects = join(CLAUDE_DIR, 'projects')
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`)
    if (!existsSync(file)) continue
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    anonFile(file, join(dest, `${sessionId}.jsonl`))
    const sub = join(projects, dir, sessionId, 'subagents')
    if (existsSync(sub)) {
      const subDest = join(dest, sessionId, 'subagents')
      mkdirSync(subDest, { recursive: true })
      for (const name of readdirSync(sub)) {
        if (name.endsWith('.jsonl')) anonFile(join(sub, name), join(subDest, name))
        else if (name.endsWith('.meta.json'))
          writeFileSync(
            join(subDest, name),
            `${anonLine(JSON.parse(readFileSync(join(sub, name), 'utf8')))}\n`
          )
      }
    }
    return true
  }
  return false
}

// ---------------------------------------------------------------- cola de entrada

function inputQueue() {
  const items = []
  let wake = null
  let closed = false
  return {
    push(message) {
      items.push(message)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) yield items.shift()
        else if (closed) return
        else await new Promise((r) => (wake = r)).then(() => (wake = null))
      }
    }
  }
}

function userMessage(text, extra = {}) {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    ...extra
  }
}

const allow = (input) => ({ behavior: 'allow', updatedInput: input })
const toolUses = (msg) =>
  msg.type === 'assistant' && Array.isArray(msg.message?.content)
    ? msg.message.content.filter((b) => b.type === 'tool_use')
    : []
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- casos

/**
 * Cada caso: `prompt`, `options` extra, `files` previos y un guion con `onMessage(msg, ctx)` y
 * `canUseTool(name, input, opts, ctx)`. `ctx.done()` cierra la entrada y termina la grabación.
 */
const CASES = {
  edicion: {
    prompt:
      "Crea con la herramienta Write el archivo notas.txt con el texto 'uno'. Después usa la herramienta Edit para cambiar 'uno' por 'dos'. Después ejecuta con Bash `git init`. Si te lo deniegan, no insistas y termina diciendo 'vale'.",
    canUseTool(name, input, opts) {
      if (name === 'Write') return allow(input)
      if (name === 'Edit')
        return {
          ...allow(input),
          updatedPermissions: (opts.suggestions ?? []).map((s) => ({
            ...s,
            destination: 'session'
          }))
        }
      return { behavior: 'deny', message: 'No inicialices git aquí.' }
    },
    onMessage(msg, ctx) {
      if (msg.type === 'result') ctx.done()
    }
  },

  cola: {
    prompt: "Ejecuta con Bash el comando `sleep 5 && echo listo` y después responde solo 'hecho'.",
    canUseTool: (_n, input) => allow(input),
    onMessage(msg, ctx) {
      if (!ctx.state.sentNext && toolUses(msg).some((t) => t.name === 'Bash')) {
        ctx.state.sentNext = true
        // «Enviar ya»: Claude lo pliega tras la herramienta en curso.
        setTimeout(
          () => ctx.push(userMessage('Además, dime cuánto es 2+2.', { priority: 'next' })),
          1000
        )
      }
      if (msg.type === 'result') {
        ctx.state.results = (ctx.state.results ?? 0) + 1
        // La cola de la app se entrega al terminar el turno: dos mensajes seguidos.
        if (ctx.state.results === 1) {
          ctx.push(userMessage("Primero di 'uno'."))
          ctx.push(userMessage("Luego di 'dos'."))
        } else ctx.done()
      }
    }
  },

  tareas: {
    files: { 'datos.txt': 'Bitácora es una app de escritorio para usar Claude Code.\n' },
    prompt:
      'Haz dos cosas, sin esperar a que terminen: 1) lanza con Bash en segundo plano (run_in_background: true) el comando `sleep 120`; 2) lanza con la herramienta Agent un subagente general-purpose en segundo plano (run_in_background: true) que lea datos.txt y lo resuma en una frase. Después termina tu turno diciendo solo "lanzadas".',
    canUseTool: (_n, input) => allow(input),
    onMessage(msg, ctx) {
      if (
        msg.type === 'system' &&
        msg.subtype === 'task_started' &&
        msg.task_type === 'local_bash' &&
        !ctx.state.stopped
      ) {
        ctx.state.stopped = true
        setTimeout(() => ctx.stopTask(msg.task_id), 3000)
      }
      if (msg.type === 'system' && msg.subtype === 'task_notification') {
        ctx.state.notified = (ctx.state.notified ?? 0) + 1
      }
      if (msg.type === 'result') {
        ctx.state.results = (ctx.state.results ?? 0) + 1
        if ((ctx.state.notified ?? 0) >= 2) ctx.doneSoon(4000)
      }
    }
  },

  pregunta: {
    prompt:
      'Usa la herramienta AskUserQuestion para preguntarme qué color prefiero, con las opciones Rojo y Azul. Después responde con una frase que use mi respuesta.',
    canUseTool(name, input) {
      if (name !== 'AskUserQuestion') return allow(input)
      const answers = {}
      for (const q of input.questions ?? []) answers[q.question] = 'Azul'
      return allow({ ...input, answers })
    },
    onMessage(msg, ctx) {
      if (msg.type === 'result') ctx.done()
    }
  },

  plan: {
    options: { permissionMode: 'plan' },
    prompt:
      "Quiero un archivo hola.txt con el texto 'hola'. Planifícalo y preséntame el plan con ExitPlanMode; cuando lo apruebe, hazlo.",
    canUseTool(name, input, _opts, ctx) {
      if (name === 'ExitPlanMode') {
        ctx.state.plans = (ctx.state.plans ?? 0) + 1
        if (ctx.state.plans === 1)
          return {
            behavior: 'deny',
            message: 'Añade un último paso que compruebe el contenido con Read.'
          }
      }
      return allow(input)
    },
    onMessage(msg, ctx) {
      if (msg.type === 'result') ctx.done()
    }
  },

  interrupcion: {
    prompt: "Ejecuta con Bash el comando `sleep 60` y después di 'fin'.",
    canUseTool: (_n, input) => allow(input),
    onMessage(msg, ctx) {
      if (!ctx.state.interrupted && toolUses(msg).some((t) => t.name === 'Bash')) {
        ctx.state.interrupted = true
        setTimeout(() => ctx.interrupt(), 2500)
      }
      if (msg.type === 'result') {
        ctx.state.results = (ctx.state.results ?? 0) + 1
        if (ctx.state.results === 1) ctx.push(userMessage("Di solo 'vale'."))
        else ctx.done()
      }
    }
  },

  /** 🔬 Tarea 5: ¿`setPermissionMode('bypassPermissions')` funciona sin reiniciar? */
  saltar: {
    prompt: "Responde solo 'listo'.",
    canUseTool(name, input, _opts, ctx) {
      ctx.state.asked = [...(ctx.state.asked ?? []), name]
      return allow(input)
    },
    async onMessage(msg, ctx) {
      if (msg.type !== 'result') return
      ctx.state.results = (ctx.state.results ?? 0) + 1
      if (ctx.state.results === 1) {
        try {
          await ctx.query.setPermissionMode('bypassPermissions')
          ctx.note({ setPermissionMode: 'ok' })
        } catch (error) {
          ctx.note({ setPermissionMode: 'error', message: String(error?.message ?? error) })
        }
        ctx.push(userMessage("Crea con Write el archivo libre.txt con el texto 'libre' y di 'ok'."))
      } else {
        ctx.note({ canUseToolCalls: ctx.state.asked ?? [] })
        ctx.done()
      }
    }
  }
}

// ---------------------------------------------------------------- grabación

async function record(name, spec, base) {
  const cwd = join(base, name)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  for (const [file, content] of Object.entries(spec.files ?? {}))
    writeFileSync(join(cwd, file), content)

  const lines = []
  const log = (obj) => lines.push(anonLine(obj))
  const input = inputQueue()
  const state = {}
  let sessionId = null
  let finished = false

  const ctx = {
    state,
    query: null,
    push(message) {
      log({ type: '_bitacora', event: 'push', message })
      input.push(message)
    },
    note(data) {
      log({ type: '_bitacora', event: 'note', ...data })
    },
    stopTask(taskId) {
      log({ type: '_bitacora', event: 'stopTask', taskId })
      void ctx.query.stopTask(taskId)
    },
    interrupt() {
      log({ type: '_bitacora', event: 'interrupt' })
      void ctx.query.interrupt()
    },
    done() {
      if (finished) return
      finished = true
      input.close()
    },
    doneSoon(ms) {
      setTimeout(() => ctx.done(), ms)
    }
  }

  const q = query({
    prompt: input,
    options: {
      cwd,
      model: MODEL,
      includePartialMessages: true,
      // Sin ajustes del usuario (hooks, CLAUDE.md, reglas): fixtures reproducibles.
      settingSources: [],
      permissionMode: 'default',
      ...spec.options,
      async canUseTool(toolName, toolInput, opts) {
        const rest = { ...opts, signal: undefined }
        log({ type: '_bitacora', event: 'canUseTool', toolName, input: toolInput, options: rest })
        const result = await spec.canUseTool(toolName, toolInput, opts, ctx)
        log({ type: '_bitacora', event: 'permissionResult', toolUseID: opts.toolUseID, result })
        return result
      }
    }
  })
  ctx.query = q
  ctx.push(userMessage(spec.prompt))

  const timer = setTimeout(() => {
    log({ type: '_bitacora', event: 'timeout' })
    q.close()
  }, TIMEOUT_MS)
  try {
    for await (const msg of q) {
      log(msg)
      if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id
      await spec.onMessage?.(msg, ctx)
    }
  } catch (error) {
    log({ type: '_bitacora', event: 'error', message: String(error?.message ?? error) })
  } finally {
    clearTimeout(timer)
  }

  writeFileSync(join(OUT, `chat-${name}.jsonl`), `${lines.join('\n')}\n`, 'utf8')
  await delay(500)
  const disk = sessionId && copyDisk(sessionId, join(OUT, `chat-${name}.disco`))
  console.log(
    `${name}: ${lines.length} mensajes, sesión ${sessionId ?? '—'}, disco ${disk ? 'sí' : 'no'}`
  )
}

async function main() {
  const [base, ...names] = process.argv.slice(2)
  if (!base) {
    console.error(`Uso: grabar-sdk.mjs <carpeta temporal> [${Object.keys(CASES).join(' | ')}]`)
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })
  for (const name of names.length ? names : Object.keys(CASES).filter((n) => n !== 'saltar')) {
    if (!CASES[name]) throw new Error(`Caso desconocido: ${name}`)
    await record(name, CASES[name], resolve(base))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
