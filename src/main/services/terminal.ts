import { randomUUID } from 'node:crypto'
import type { TerminalInfo, TerminalKind, TerminalOpenInput } from '../../shared/terminal'
import type { Logger } from './logger'
import { claudeLine, shellArgs, type ShellInfo } from './shell'

/**
 * Pseudoterminales de la vista Terminal. node-pty llega inyectado como
 * `spawn`. La salida se guarda en un búfer acotado (para volver a pintar al cambiar de vista) y se
 * envía a la ventana dueña en lotes de ~8 ms.
 */

export interface PtyLike {
  readonly pid: number
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: {
    name: string
    cols: number
    rows: number
    cwd: string
    env: Record<string, string>
    useConpty?: boolean
  }
) => PtyLike

/** Carpeta, título y sesión que resuelve el main para una petición. */
export interface ResolvedTarget {
  cwd: string
  /** «bitacora» o el título de la sesión. */
  label: string
  sessionId?: string
}

export interface TerminalServiceDeps {
  spawn: SpawnPty
  /** Shell a usar (el de Ajustes si existe; si no, el predeterminado). */
  shell: () => Promise<ShellInfo>
  env: () => Promise<Record<string, string>>
  claude: () => Promise<{ onPath: boolean; bundled: string | null }>
  resolve: (input: TerminalOpenInput) => Promise<ResolvedTarget>
  send: (owner: number, channel: 'terminal:data' | 'terminal:exit', payload: unknown) => void
  now?: () => number
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export class TerminalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalError'
  }
}

export const MAX_TERMINALS = 8
const BUFFER_MAX = 2 * 1024 * 1024
const BATCH_MS = 8
/** Si el shell tarda en escribir el prompt, la orden se escribe igualmente. */
const COMMAND_FALLBACK_MS = 500

interface Terminal {
  info: TerminalInfo
  owner: number
  input: TerminalOpenInput
  pty: PtyLike
  /** Sube al reiniciar: las salidas del proceso anterior se ignoran. */
  generation: number
  chunks: string[]
  size: number
  pending: string
  timer: ReturnType<typeof setTimeout> | null
}

/** Recorta por el principio hasta caber en `max`, empezando en un salto de línea. */
export function trimBuffer(chunks: string[], size: number, max: number): number {
  while (size > max && chunks.length > 1) size -= chunks.shift()!.length
  if (size > max && chunks.length === 1) {
    const only = chunks[0]!
    let cut = only.slice(only.length - max)
    const nl = cut.indexOf('\n')
    if (nl >= 0 && nl < cut.length - 1) cut = cut.slice(nl + 1)
    chunks[0] = cut
    size = cut.length
  }
  return size
}

export interface TerminalService {
  open(owner: number, input: TerminalOpenInput): Promise<TerminalInfo>
  list(owner?: number): TerminalInfo[]
  /** Info y salida guardada; la ventana pasa a ser la dueña (recarga del renderer). */
  attach(owner: number, id: string): { info: TerminalInfo; buffer: string }
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  restart(id: string): Promise<TerminalInfo>
  close(id: string): void
  /** La ventana se cerró: sus terminales también. */
  closeOwner(owner: number): void
  disposeAll(): void
  /** Terminales con el proceso vivo (confirmación de cierre). */
  running(): number
}

interface Launched {
  pty: PtyLike
  info: TerminalInfo
  command: string | null
}

export function createTerminalService(deps: TerminalServiceDeps): TerminalService {
  const now = deps.now ?? Date.now
  const terminals = new Map<string, Terminal>()

  function flush(t: Terminal): void {
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    if (!t.pending) return
    const data = t.pending
    t.pending = ''
    deps.send(t.owner, 'terminal:data', { id: t.info.id, data })
  }

  function titleOf(kind: TerminalKind, shell: ShellInfo, target: ResolvedTarget): string {
    if (kind === 'shell') return `${shell.label} · ${target.label}`
    return `claude · ${target.label}`
  }

  async function launch(t: { id: string; input: TerminalOpenInput }): Promise<Launched> {
    const target = await deps.resolve(t.input)
    const [shell, env, claude] = await Promise.all([deps.shell(), deps.env(), deps.claude()])
    let command: string | null = null
    if (t.input.kind !== 'shell') {
      command = claudeLine(
        shell.kind,
        claude,
        t.input.kind === 'resume' ? target.sessionId : undefined
      )
    }
    const pty = deps.spawn(shell.path, shellArgs(shell), {
      name: 'xterm-256color',
      cols: t.input.cols,
      rows: t.input.rows,
      cwd: target.cwd,
      env,
      useConpty: true
    })
    const info: TerminalInfo = {
      id: t.id,
      kind: t.input.kind,
      title: titleOf(t.input.kind, shell, target),
      cwd: target.cwd,
      shell: shell.label,
      ...(target.sessionId ? { sessionId: target.sessionId } : {}),
      status: 'running',
      startedAt: now()
    }
    return { pty, info, command }
  }

  function wire(t: Terminal, command: string | null, missingClaude: boolean): void {
    const generation = t.generation
    let sent = command === null
    const sendCommand = (): void => {
      if (sent || t.generation !== generation || t.info.status !== 'running') return
      sent = true
      t.pty.write(`${command}\r`)
    }
    const fallback = command ? setTimeout(sendCommand, COMMAND_FALLBACK_MS) : null
    if (missingClaude) {
      append(
        t,
        '\r\n\x1b[33mNo se encontró Claude Code (`claude`) en el PATH ni en la app.\x1b[0m\r\n'
      )
    }

    t.pty.onData((data) => {
      if (t.generation !== generation) return
      append(t, data)
      if (!sent) {
        if (fallback) clearTimeout(fallback)
        // Tras el primer trozo, el shell ya está listo para leer.
        setTimeout(sendCommand, 50)
      }
    })
    t.pty.onExit(({ exitCode }) => {
      if (t.generation !== generation) return
      if (fallback) clearTimeout(fallback)
      flush(t)
      t.info = { ...t.info, status: 'exited', exitCode }
      deps.send(t.owner, 'terminal:exit', { id: t.info.id, exitCode })
    })
  }

  function append(t: Terminal, data: string): void {
    t.chunks.push(data)
    t.size = trimBuffer(t.chunks, t.size + data.length, BUFFER_MAX)
    t.pending += data
    t.timer ??= setTimeout(() => flush(t), BATCH_MS)
  }

  function get(id: string): Terminal {
    const t = terminals.get(id)
    if (!t) throw new TerminalError('Esa terminal ya no existe')
    return t
  }

  function kill(t: Terminal): void {
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    try {
      t.pty.kill()
    } catch (error) {
      deps.log?.warn('terminal', `No se pudo cerrar la terminal: ${String(error)}`)
    }
  }

  const service: TerminalService = {
    async open(owner: number, input: TerminalOpenInput): Promise<TerminalInfo> {
      const alive = [...terminals.values()].filter((t) => t.info.status === 'running').length
      if (alive >= MAX_TERMINALS) throw new TerminalError(`Máximo de ${MAX_TERMINALS} terminales`)
      const id = randomUUID()
      const { pty, info, command } = await launch({ id, input })
      const t: Terminal = {
        info,
        owner,
        input,
        pty,
        generation: 0,
        chunks: [],
        size: 0,
        pending: '',
        timer: null
      }
      terminals.set(id, t)
      wire(t, command, input.kind !== 'shell' && command === null)
      deps.log?.info('terminal', `Terminal abierta (${input.kind}, ${info.shell})`)
      return info
    },

    list(owner) {
      return [...terminals.values()]
        .filter((t) => owner === undefined || t.owner === owner)
        .map((t) => t.info)
    },

    attach(owner, id) {
      const t = get(id)
      flush(t)
      t.owner = owner
      return { info: t.info, buffer: t.chunks.join('') }
    },

    write(id: string, data: string): void {
      const t = get(id)
      if (t.info.status === 'running') t.pty.write(data)
    },

    resize(id: string, cols: number, rows: number): void {
      const t = get(id)
      t.input = { ...t.input, cols, rows }
      if (t.info.status !== 'running') return
      try {
        t.pty.resize(cols, rows)
      } catch (error) {
        deps.log?.warn('terminal', `No se pudo redimensionar: ${String(error)}`)
      }
    },

    async restart(id: string): Promise<TerminalInfo> {
      const t = get(id)
      if (t.info.status === 'running') kill(t)
      t.generation++
      t.chunks = []
      t.size = 0
      t.pending = ''
      const { pty, info, command } = await launch({ id, input: t.input })
      t.pty = pty
      t.info = info
      wire(t, command, t.input.kind !== 'shell' && command === null)
      return info
    },

    close(id: string): void {
      const t = terminals.get(id)
      if (!t) return
      t.generation++
      if (t.info.status === 'running') kill(t)
      terminals.delete(id)
    },

    closeOwner(owner) {
      for (const t of [...terminals.values()]) if (t.owner === owner) service.close(t.info.id)
    },

    disposeAll() {
      for (const id of [...terminals.keys()]) service.close(id)
    },

    running() {
      return [...terminals.values()].filter((t) => t.info.status === 'running').length
    }
  }
  return service
}
