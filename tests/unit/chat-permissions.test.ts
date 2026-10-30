import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  PermissionBroker,
  rewriteSuggestions,
  suggestionLabels,
  type CanUseToolOptions
} from '../../src/main/services/chat/permissions'
import type { ChatMode, PermissionDecision, PermissionRequestView } from '../../src/shared/chat'
import { fixtureLines, type ChatCase } from './chat-fixtures'

/** Peticiones `canUseTool` reales grabadas en un fixture, en orden. */
function requests(
  name: ChatCase
): { toolName: string; input: Record<string, unknown>; options: CanUseToolOptions }[] {
  return fixtureLines(name)
    .filter((l) => l['type'] === '_bitacora' && l['event'] === 'canUseTool')
    .map((l) => ({
      toolName: l['toolName'] as string,
      input: l['input'] as Record<string, unknown>,
      options: { ...(l['options'] as CanUseToolOptions), signal: new AbortController().signal }
    }))
}

function setup(): {
  broker: PermissionBroker
  requested: PermissionRequestView[]
  resolved: [string, PermissionDecision][]
  modes: ChatMode[]
  logs: string[]
} {
  const requested: PermissionRequestView[] = []
  const resolved: [string, PermissionDecision][] = []
  const modes: ChatMode[] = []
  const logs: string[] = []
  const broker = new PermissionBroker({
    onRequest: (v) => requested.push(v),
    onResolved: (v, d) => resolved.push([v.toolName, d]),
    onModeChange: (m) => modes.push(m),
    log: (m) => logs.push(m)
  })
  return { broker, requested, resolved, modes, logs }
}

describe('PermissionBroker', () => {
  it('Write: tarjeta con la vista y «Permitir una vez»', async () => {
    const { broker, requested, resolved } = setup()
    const [write] = requests('edicion')
    const promise = broker.canUseTool(write!.toolName, write!.input, write!.options)
    expect(requested).toHaveLength(1)
    const view = requested[0]!
    expect(view).toMatchObject({
      toolName: 'Write',
      kind: 'tool',
      toolUseId: write!.options.toolUseID,
      description: 'notas.txt',
      alwaysLabels: ['modo Aceptar ediciones']
    })
    expect(view.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(broker.list()).toEqual([view])
    expect(broker.respond({ requestId: view.requestId, decision: 'allow' })).toBe(true)
    await expect(promise).resolves.toEqual({ behavior: 'allow', updatedInput: write!.input })
    expect(resolved).toEqual([['Write', 'allowed']])
    expect(broker.decisions[write!.options.toolUseID]).toBe('allowed')
    expect(broker.size).toBe(0)
  })

  it('una respuesta solo vale una vez y solo para su petición', async () => {
    const { broker, requested, logs } = setup()
    const [write] = requests('edicion')
    const promise = broker.canUseTool(write!.toolName, write!.input, write!.options)
    expect(
      broker.respond({ requestId: '00000000-0000-4000-8000-000000000000', decision: 'allow' })
    ).toBe(false)
    expect(broker.size).toBe(1)
    expect(broker.respond({ requestId: requested[0]!.requestId, decision: 'deny' })).toBe(true)
    expect(broker.respond({ requestId: requested[0]!.requestId, decision: 'allow' })).toBe(false)
    await expect(promise).resolves.toMatchObject({ behavior: 'deny' })
    expect(logs).toHaveLength(2)
  })

  it('Bash: «Permitir siempre» en el proyecto → localSettings; en la sesión → session', async () => {
    const bash = requests('edicion').find((r) => r.toolName === 'Bash')!
    for (const [scope, destination] of [
      ['project', 'localSettings'],
      ['session', 'session']
    ] as const) {
      const { broker, requested } = setup()
      const promise = broker.canUseTool(bash.toolName, bash.input, bash.options)
      expect(requested[0]!.alwaysLabels).toEqual(['Bash(git init *)'])
      broker.respond({ requestId: requested[0]!.requestId, decision: 'always', scope })
      const result = await promise
      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: bash.input,
        updatedPermissions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'git init *' }],
            behavior: 'allow',
            destination
          }
        ]
      })
      expect(broker.decisions[bash.options.toolUseID]).toBe('always')
    }
  })

  it('«Permitir siempre» con setMode cambia el modo de la sesión', async () => {
    const { broker, requested, modes } = setup()
    const edit = requests('edicion').find((r) => r.toolName === 'Edit')!
    const promise = broker.canUseTool(edit.toolName, edit.input, edit.options)
    broker.respond({ requestId: requested[0]!.requestId, decision: 'always', scope: 'project' })
    await expect(promise).resolves.toMatchObject({
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
    })
    expect(modes).toEqual(['acceptEdits'])
  })

  it('denegar con motivo: Claude recibe el motivo; sin motivo, uno por defecto', async () => {
    const { broker, requested } = setup()
    const bash = requests('edicion').find((r) => r.toolName === 'Bash')!
    const a = broker.canUseTool(bash.toolName, bash.input, bash.options)
    broker.respond({ requestId: requested[0]!.requestId, decision: 'deny', message: ' No aquí ' })
    await expect(a).resolves.toEqual({ behavior: 'deny', message: 'No aquí' })
    const b = broker.canUseTool(bash.toolName, bash.input, bash.options)
    broker.respond({ requestId: requested[1]!.requestId, decision: 'deny' })
    await expect(b).resolves.toEqual({
      behavior: 'deny',
      message: 'El usuario ha denegado el permiso.'
    })
  })

  it('AskUserQuestion: las respuestas vuelven en updatedInput.answers', async () => {
    const { broker, requested } = setup()
    const [ask] = requests('pregunta')
    const promise = broker.canUseTool(ask!.toolName, ask!.input, ask!.options)
    expect(requested[0]).toMatchObject({ kind: 'question', noAlways: true, alwaysLabels: [] })
    const question = (ask!.input['questions'] as { question: string }[])[0]!.question
    broker.respond({
      requestId: requested[0]!.requestId,
      decision: 'allow',
      answers: { [question]: 'Azul' }
    })
    await expect(promise).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { ...ask!.input, answers: { [question]: 'Azul' } }
    })
  })

  it('AskUserQuestion sin respuestas → deny', async () => {
    const { broker, requested } = setup()
    const [ask] = requests('pregunta')
    const promise = broker.canUseTool(ask!.toolName, ask!.input, ask!.options)
    broker.respond({ requestId: requested[0]!.requestId, decision: 'allow', answers: {} })
    await expect(promise).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('ExitPlanMode: «Seguir planificando» con comentario y «Aprobar» sale del modo plan', async () => {
    const { broker, requested, modes } = setup()
    const [first, second] = requests('plan').filter((r) => r.toolName === 'ExitPlanMode')
    const a = broker.canUseTool(first!.toolName, first!.input, first!.options)
    expect(requested[0]!.kind).toBe('plan')
    broker.respond({
      requestId: requested[0]!.requestId,
      decision: 'deny',
      message: 'Añade una comprobación'
    })
    await expect(a).resolves.toEqual({ behavior: 'deny', message: 'Añade una comprobación' })
    const b = broker.canUseTool(second!.toolName, second!.input, second!.options)
    broker.respond({ requestId: requested[1]!.requestId, decision: 'allow' })
    await expect(b).resolves.toEqual({ behavior: 'allow', updatedInput: second!.input })
    expect(modes).toEqual(['default'])
  })

  it('el signal del SDK cancela la tarjeta', async () => {
    const { broker, resolved } = setup()
    const [write] = requests('edicion')
    const abort = new AbortController()
    const promise = broker.canUseTool(write!.toolName, write!.input, {
      ...write!.options,
      signal: abort.signal
    })
    abort.abort()
    await expect(promise).resolves.toMatchObject({ behavior: 'deny' })
    expect(resolved).toEqual([['Write', 'cancelled']])
    expect(broker.decisions[write!.options.toolUseID]).toBe('cancelled')
  })

  it('cancelAll deniega todo lo pendiente', async () => {
    const { broker, resolved } = setup()
    const reqs = requests('edicion')
    const promises = reqs.map((r) => broker.canUseTool(r.toolName, r.input, r.options))
    broker.cancelAll()
    for (const p of promises) await expect(p).resolves.toMatchObject({ behavior: 'deny' })
    expect(resolved.map(([, d]) => d)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  })

  it('sin sugerencias o con suppressAlwaysAllowRule, «siempre» es «una vez»', async () => {
    const { broker, requested } = setup()
    const signal = new AbortController().signal
    const promise = broker.canUseTool(
      'Bash',
      { command: 'ls' },
      {
        signal,
        toolUseID: 't1',
        suppressAlwaysAllowRule: true,
        suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash' }],
            behavior: 'allow',
            destination: 'localSettings'
          }
        ]
      }
    )
    expect(requested[0]!.noAlways).toBe(true)
    broker.respond({ requestId: requested[0]!.requestId, decision: 'always', scope: 'project' })
    await expect(promise).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(broker.decisions['t1']).toBe('allowed')
  })

  it('«Todo en esta sesión» permite la petición y avisa a la sesión, aunque no haya sugerencias', async () => {
    const requested: PermissionRequestView[] = []
    const resolved: PermissionDecision[] = []
    let allowAll = 0
    const broker = new PermissionBroker({
      onRequest: (v) => requested.push(v),
      onResolved: (_, d) => resolved.push(d),
      onAllowAll: () => (allowAll += 1)
    })
    const promise = broker.canUseTool(
      'Bash',
      { command: 'ls' },
      { signal: new AbortController().signal, toolUseID: 't1' }
    )
    expect(broker.respond({ requestId: requested[0]!.requestId, decision: 'all' })).toBe(true)
    await expect(promise).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(resolved).toEqual(['always'])
    expect(allowAll).toBe(1)
  })

  it('con aprobación automática las herramientas pasan sin tarjeta; las preguntas no', async () => {
    const { broker, requested, resolved } = setup()
    const reqs = requests('edicion')
    const pending = reqs.map((r) => broker.canUseTool(r.toolName, r.input, r.options))
    expect(broker.size).toBe(reqs.length)

    broker.setAutoAllow(true)
    for (const [i, p] of pending.entries())
      await expect(p).resolves.toEqual({ behavior: 'allow', updatedInput: reqs[i]!.input })
    expect(resolved.map(([, d]) => d)).toEqual(reqs.map(() => 'always'))
    expect(broker.size).toBe(0)

    const before = requested.length
    const [write] = reqs
    await expect(broker.canUseTool(write!.toolName, write!.input, write!.options)).resolves.toEqual(
      { behavior: 'allow', updatedInput: write!.input }
    )
    expect(requested).toHaveLength(before)

    const [ask] = requests('pregunta')
    void broker.canUseTool(ask!.toolName, ask!.input, ask!.options)
    expect(requested.at(-1)).toMatchObject({ kind: 'question' })

    broker.setAutoAllow(false)
    void broker.canUseTool(write!.toolName, write!.input, write!.options)
    expect(requested.at(-1)).toMatchObject({ kind: 'tool', toolName: 'Write' })
  })
})

describe('reglas de «Permitir siempre» (pregunta abierta 1)', () => {
  const all: PermissionUpdate[] = [
    {
      type: 'addRules',
      rules: [{ toolName: 'Read' }],
      behavior: 'allow',
      destination: 'userSettings'
    },
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      behavior: 'allow',
      destination: 'projectSettings'
    },
    { type: 'setMode', mode: 'acceptEdits', destination: 'localSettings' },
    { type: 'addDirectories', directories: ['C:\\otra'], destination: 'cliArg' },
    {
      type: 'removeRules',
      rules: [{ toolName: 'Bash' }],
      behavior: 'deny',
      destination: 'userSettings'
    }
  ]

  it('nunca userSettings ni projectSettings, sea cual sea el ámbito', () => {
    for (const scope of ['session', 'project'] as const) {
      const out = rewriteSuggestions(all, scope)
      expect(out).toHaveLength(4)
      for (const update of out) {
        expect(['session', 'localSettings']).toContain(update.destination)
        if (update.type === 'setMode') expect(update.destination).toBe('session')
      }
    }
  })

  it('etiquetas legibles', () => {
    expect(suggestionLabels(all)).toEqual([
      'Read',
      'Bash(npm test:*)',
      'modo Aceptar ediciones',
      'acceso a C:\\otra'
    ])
  })
})
