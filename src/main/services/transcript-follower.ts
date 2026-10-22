import { stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import type { SubagentInfo, TranscriptAppend, TranscriptItem } from '../../shared/sessions'
import { listSubagents } from './claude-paths'
import { readJsonl } from './jsonl-reader'
import { logger as defaultLogger, type Logger } from './logger'
import { readMeta, type FollowState } from './session-loader'
import { SessionAccumulator } from './session-parser'

/**
 * Seguimiento de la sesión abierta en cada ventana. Guarda el acumulador y
 * la posición de cada archivo de la última lectura del visor y, cuando el watcher avisa de que
 * alguno cambió, lee solo lo nuevo y emite `sessions:appended`. Solo lectura.
 */

export interface FollowerOptions {
  emit: (target: number, event: TranscriptAppend) => void
  /** Entrada de la lista para la sesión `continued-in` (o el propio id si no está indexada). */
  resolveEntry?: (sessionId: string) => string
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface TranscriptFollower {
  track(target: number, sessionId: string, file: string, state: FollowState): void
  untrack(target: number): void
  /** Rutas cambiadas (lote del watcher); `[]` = sondeo: se comprueban todas por `stat`. */
  onPaths(paths: string[]): Promise<void>
  readonly size: number
}

interface Tracked {
  sessionId: string
  file: string
  /** Carpeta `<id>/` con `subagents/`. */
  dir: string
  state: FollowState
  size: number
  continuedIn?: string
  /** Lectura en curso: los lotes siguientes se encadenan. */
  chain: Promise<void>
}

function samePath(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

function inside(path: string, dir: string): boolean {
  const p = normalize(path)
  const d = normalize(dir) + sep
  return process.platform === 'win32'
    ? p.toLowerCase().startsWith(d.toLowerCase())
    : p.startsWith(d)
}

function subagentInfos(tracked: Tracked): SubagentInfo[] {
  return [...tracked.state.subs.entries()].map(([agentId, sub]) => {
    const stats = sub.acc.stats()
    return {
      agentId,
      ...(sub.meta.agentType ? { agentType: sub.meta.agentType } : {}),
      ...(sub.meta.description ? { description: sub.meta.description } : {}),
      ...(sub.meta.toolUseId ? { toolUseId: sub.meta.toolUseId } : {}),
      file: sub.file,
      messageCount: stats.messageCount,
      toolCallCount: stats.toolCallCount
    }
  })
}

export function createTranscriptFollower(options: FollowerOptions): TranscriptFollower {
  const log = options.log ?? defaultLogger
  const tracked = new Map<number, Tracked>()

  async function read(target: number, t: Tracked): Promise<void> {
    if (tracked.get(target) !== t) return
    const reset = (): void => {
      tracked.delete(target)
      options.emit(target, {
        sessionId: t.sessionId,
        items: [],
        reset: true,
        writtenAt: Date.now()
      })
    }

    let info
    try {
      info = await stat(t.file)
    } catch {
      reset()
      return
    }
    if (info.size < t.size) {
      reset()
      return
    }

    const main = t.state.main
    const chunk = await readJsonl(t.file, main.pos)
    if (chunk.error || chunk.reset) {
      reset()
      return
    }
    t.size = info.size
    main.acc.addChunk(chunk)
    main.pos = { offset: chunk.offset, line: chunk.line }
    const items = main.acc.drainItems()

    // Subagentes: los nuevos con su `.meta.json`; de los conocidos, lo nuevo.
    const subagentItems: Record<string, TranscriptItem[]> = {}
    let subsChanged = false
    for (const ref of await listSubagents(t.dir)) {
      let sub = t.state.subs.get(ref.agentId)
      if (!sub) {
        const meta = await readMeta(ref)
        if (meta.toolUseId) t.state.byToolUse.set(meta.toolUseId, meta)
        sub = {
          acc: new SessionAccumulator({ agentId: ref.agentId }),
          pos: { offset: 0, line: 0 },
          meta,
          file: ref.file
        }
        t.state.subs.set(ref.agentId, sub)
        subsChanged = true
      }
      const subChunk = await readJsonl(ref.file, sub.pos)
      if (subChunk.error) continue
      if (subChunk.reset) {
        sub.acc = new SessionAccumulator({ agentId: ref.agentId })
        subsChanged = true
      }
      sub.acc.addChunk(subChunk)
      sub.pos = { offset: subChunk.offset, line: subChunk.line }
      const fresh = sub.acc.drainItems()
      if (fresh.length > 0) {
        subagentItems[ref.agentId] = fresh
        subsChanged = true
      }
    }

    const stats = main.acc.stats()
    let continuedIn: string | undefined
    if (stats.continuedIn && stats.continuedIn !== t.continuedIn) {
      t.continuedIn = stats.continuedIn
      continuedIn = options.resolveEntry?.(stats.continuedIn) ?? stats.continuedIn
    }

    if (items.length === 0 && !subsChanged && !continuedIn) return
    options.emit(target, {
      sessionId: t.sessionId,
      items,
      ...(subsChanged ? { subagents: subagentInfos(t), subagentItems } : {}),
      ...(continuedIn ? { continuedIn } : {}),
      ...(stats.updatedAt ? { updatedAt: stats.updatedAt } : {}),
      writtenAt: info.mtimeMs
    })
  }

  return {
    track(target, sessionId, file, state) {
      const dir = join(file, '..', sessionId)
      tracked.set(target, {
        sessionId,
        file,
        dir,
        state,
        size: state.main.pos.offset,
        ...(state.main.acc.stats().continuedIn
          ? { continuedIn: state.main.acc.stats().continuedIn }
          : {}),
        chain: Promise.resolve()
      })
    },
    untrack(target) {
      tracked.delete(target)
    },
    async onPaths(paths) {
      const runs: Promise<void>[] = []
      for (const [target, t] of tracked) {
        const relevant =
          paths.length === 0 || paths.some((p) => samePath(p, t.file) || inside(p, t.dir))
        if (!relevant) continue
        t.chain = t.chain.then(() => read(target, t)).catch((error) => log.error('follower', error))
        runs.push(t.chain)
      }
      await Promise.all(runs)
    },
    get size() {
      return tracked.size
    }
  }
}
