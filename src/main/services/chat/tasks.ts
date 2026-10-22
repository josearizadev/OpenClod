import type { TaskView } from '../../../shared/chat'

/**
 * Tareas de una sesión de chat a partir de los mensajes `task_*` del SDK.
 * Reductor puro: recibe el estado y un mensaje y devuelve el estado nuevo, sin mutarlo. Las tareas
 * `ambient` o `skip_transcript` no entran.
 */

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export interface TasksState {
  tasks: ReadonlyMap<string, TaskView>
  /** Tareas que no se muestran (`ambient`, `skip_transcript`). */
  ignored: ReadonlySet<string>
}

export const EMPTY_TASKS: TasksState = { tasks: new Map(), ignored: new Set() }

/** Tiempo que una tarea terminada sigue a la vista, para que se vea su estado. */
export const ENDED_VISIBLE_MS = 10_000

function typeOf(taskType: unknown): TaskView['type'] {
  if (taskType === 'local_agent') return 'agent'
  if (taskType === 'local_bash') return 'bash'
  return 'other'
}

const PATCH_STATUS: Record<string, TaskView['status']> = {
  pending: 'running',
  running: 'running',
  paused: 'running',
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped'
}

const NOTIFICATION_STATUS: Record<string, TaskView['status']> = {
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped'
}

function skipped(msg: Obj): boolean {
  return msg['ambient'] === true || msg['skip_transcript'] === true
}

export function reduceTasks(state: TasksState, msg: unknown, now: number): TasksState {
  if (!isObj(msg) || msg['type'] !== 'system') return state
  const subtype = msg['subtype']

  if (subtype === 'background_tasks_changed') return applyLiveList(state, msg['tasks'], now)

  const taskId = str(msg['task_id'])
  if (!taskId) return state
  if (state.ignored.has(taskId)) return state
  if (skipped(msg)) {
    const tasks = new Map(state.tasks)
    tasks.delete(taskId)
    return { tasks, ignored: new Set(state.ignored).add(taskId) }
  }

  const current = state.tasks.get(taskId)
  let next: TaskView | undefined
  switch (subtype) {
    case 'task_started': {
      const toolUseId = str(msg['tool_use_id']) ?? current?.toolUseId
      const subagentType = str(msg['subagent_type']) ?? current?.subagentType
      next = {
        taskId,
        ...(toolUseId ? { toolUseId } : {}),
        type:
          msg['task_type'] !== undefined ? typeOf(msg['task_type']) : (current?.type ?? 'other'),
        description: str(msg['description']) ?? current?.description ?? '',
        ...(subagentType ? { subagentType } : {}),
        background: msg['is_backgrounded'] === true || current?.background === true,
        status: 'running',
        startedAt: current?.startedAt ?? now
      }
      break
    }
    case 'task_progress': {
      if (!current) return state
      const usage = isObj(msg['usage']) ? msg['usage'] : {}
      const progress = str(msg['summary']) ?? str(msg['description']) ?? str(msg['last_tool_name'])
      next = {
        ...current,
        ...(progress && progress !== current.description ? { lastProgress: progress } : {}),
        ...(typeof usage['tool_uses'] === 'number' ? { toolUses: usage['tool_uses'] } : {})
      }
      break
    }
    case 'task_updated': {
      if (!current) return state
      const patch = isObj(msg['patch']) ? msg['patch'] : {}
      const status = typeof patch['status'] === 'string' ? PATCH_STATUS[patch['status']] : undefined
      next = {
        ...current,
        ...(status ? { status } : {}),
        ...(typeof patch['is_backgrounded'] === 'boolean'
          ? { background: patch['is_backgrounded'] }
          : {}),
        ...(str(patch['description']) ? { description: str(patch['description']) as string } : {})
      }
      if (status && status !== 'running') next.endedAt = current.endedAt ?? now
      break
    }
    case 'task_notification': {
      const status =
        typeof msg['status'] === 'string' ? NOTIFICATION_STATUS[msg['status']] : undefined
      if (!status) return state
      const base: TaskView = current ?? {
        taskId,
        type: 'other',
        description: str(msg['summary']) ?? '',
        background: true,
        status: 'running',
        startedAt: now
      }
      const summary = str(msg['summary'])
      const toolUseId = str(msg['tool_use_id']) ?? base.toolUseId
      next = {
        ...base,
        ...(toolUseId ? { toolUseId } : {}),
        status,
        endedAt: base.endedAt ?? now,
        ...(summary && summary !== base.description ? { lastProgress: summary } : {})
      }
      break
    }
    default:
      return state
  }

  const tasks = new Map(state.tasks)
  tasks.set(taskId, next)
  return { tasks, ignored: state.ignored }
}

/**
 * `background_tasks_changed` trae la lista de las tareas en segundo plano vivas: crea las que aún
 * no se conocían y da por terminadas las de segundo plano que ya no están.
 */
function applyLiveList(state: TasksState, list: unknown, now: number): TasksState {
  if (!Array.isArray(list)) return state
  const tasks = new Map(state.tasks)
  const alive = new Set<string>()
  for (const entry of list) {
    if (!isObj(entry)) continue
    const taskId = str(entry['task_id'])
    if (!taskId || state.ignored.has(taskId) || skipped(entry)) continue
    alive.add(taskId)
    if (tasks.has(taskId)) continue
    const subagentType = str(entry['subagent_type'])
    tasks.set(taskId, {
      taskId,
      type: typeOf(entry['task_type']),
      description: str(entry['description']) ?? '',
      ...(subagentType ? { subagentType } : {}),
      background: true,
      status: 'running',
      startedAt: now
    })
  }
  for (const [id, task] of tasks) {
    if (task.background && task.status === 'running' && !alive.has(id)) {
      tasks.set(id, { ...task, status: 'completed', endedAt: now })
    }
  }
  return { tasks, ignored: state.ignored }
}

/** Quita las terminadas hace más de `ENDED_VISIBLE_MS`. */
export function pruneTasks(state: TasksState, now: number): TasksState {
  let changed = false
  const tasks = new Map(state.tasks)
  for (const [id, task] of tasks) {
    if (task.endedAt !== undefined && now - task.endedAt > ENDED_VISIBLE_MS) {
      tasks.delete(id)
      changed = true
    }
  }
  return changed ? { tasks, ignored: state.ignored } : state
}

/** Las que muestra el indicador: solo las de segundo plano, por orden de inicio. */
export function visibleTasks(state: TasksState): TaskView[] {
  return [...state.tasks.values()]
    .filter((t) => t.background)
    .sort((a, b) => a.startedAt - b.startedAt)
}

/** Hay tareas vivas: la sesión no se cierra por inactividad y el indicador sigue. */
export function hasRunningTasks(state: TasksState): boolean {
  for (const task of state.tasks.values()) {
    if (task.background && task.status === 'running') return true
  }
  return false
}
