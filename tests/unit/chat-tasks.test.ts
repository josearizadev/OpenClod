import { describe, expect, it } from 'vitest'
import {
  EMPTY_TASKS,
  ENDED_VISIBLE_MS,
  hasRunningTasks,
  pruneTasks,
  reduceTasks,
  visibleTasks,
  type TasksState
} from '../../src/main/services/chat/tasks'
import { sdkMessages, type ChatCase } from './chat-fixtures'

/** Aplica los mensajes de tareas de un fixture; `stop` para tras `n` mensajes de tareas. */
function run(name: ChatCase, stop = Infinity): TasksState {
  let state = EMPTY_TASKS
  let now = 1000
  let n = 0
  for (const msg of sdkMessages(name)) {
    if (msg['type'] !== 'system') continue
    const before = state
    state = reduceTasks(state, msg, (now += 100))
    if (state !== before && ++n >= stop) break
  }
  return state
}

describe('tareas', () => {
  it('primer plano: un Bash normal emite task_started pero no va al indicador', () => {
    const state = run('cola')
    const [task] = [...state.tasks.values()]
    expect(task).toMatchObject({ type: 'bash', background: false, status: 'completed' })
    expect(visibleTasks(state)).toEqual([])
    expect(hasRunningTasks(state)).toBe(false)
  })

  it('segundo plano: subagente y Bash en el indicador mientras corren', () => {
    // Hasta el primer task_progress del subagente.
    const state = run('tareas', 5)
    const visible = visibleTasks(state)
    expect(visible.map((t) => [t.type, t.status, t.background])).toEqual([
      ['agent', 'running', true],
      ['bash', 'running', true]
    ])
    expect(visible[0]).toMatchObject({
      taskId: 'a9d629e147f1c33e9',
      toolUseId: 'toolu_01RCFSes148E8JyCRjwuNpiB',
      subagentType: 'general-purpose',
      description: 'Resumir datos.txt en una frase',
      lastProgress: 'Reading datos.txt'
    })
    expect(hasRunningTasks(state)).toBe(true)
  })

  it('al final: subagente completado y Bash detenido con stopTask', () => {
    const state = run('tareas')
    const byType = Object.fromEntries(visibleTasks(state).map((t) => [t.type, t]))
    expect(byType['agent']).toMatchObject({ status: 'completed' })
    expect(byType['bash']).toMatchObject({
      status: 'stopped',
      toolUseId: 'toolu_01Dmo5R1zPoJZTqCdj1dkzVf'
    })
    expect(byType['bash']!.endedAt).toBeDefined()
    expect(hasRunningTasks(state)).toBe(false)
  })

  it('las terminadas se quedan 10 s y luego salen', () => {
    const state = run('tareas')
    const ends = [...state.tasks.values()].map((t) => t.endedAt ?? 0)
    expect(pruneTasks(state, Math.min(...ends) + ENDED_VISIBLE_MS)).toBe(state)
    expect(pruneTasks(state, Math.max(...ends) + ENDED_VISIBLE_MS + 1).tasks.size).toBe(0)
  })

  it('ambient y skip_transcript no entran', () => {
    let state = reduceTasks(
      EMPTY_TASKS,
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'amb',
        task_type: 'local_bash',
        is_backgrounded: true,
        ambient: true,
        description: 'x'
      },
      1
    )
    state = reduceTasks(
      state,
      { type: 'system', subtype: 'task_progress', task_id: 'amb', description: 'y' },
      2
    )
    state = reduceTasks(
      state,
      {
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          { task_id: 'amb', task_type: 'local_bash' },
          { task_id: 'b2', task_type: 'local_bash', skip_transcript: true }
        ]
      },
      3
    )
    expect(state.tasks.size).toBe(0)
  })

  it('background_tasks_changed da por terminadas las que ya no están', () => {
    let state = reduceTasks(
      EMPTY_TASKS,
      {
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [{ task_id: 'b1', task_type: 'local_bash', description: 'sleep' }]
      },
      1
    )
    expect(visibleTasks(state)).toMatchObject([{ taskId: 'b1', status: 'running', startedAt: 1 }])
    state = reduceTasks(
      state,
      { type: 'system', subtype: 'background_tasks_changed', tasks: [] },
      5
    )
    expect(visibleTasks(state)).toMatchObject([{ taskId: 'b1', status: 'completed', endedAt: 5 }])
  })

  it('mensajes raros no cambian nada', () => {
    for (const msg of [
      null,
      'x',
      { type: 'system' },
      { type: 'system', subtype: 'task_progress', task_id: 'nadie' }
    ]) {
      expect(reduceTasks(EMPTY_TASKS, msg, 1)).toBe(EMPTY_TASKS)
    }
  })
})
