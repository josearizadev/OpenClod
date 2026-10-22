import { describe, expect, it } from 'vitest'
import { activityLabel, type ActivityInput } from '../../src/renderer/src/lib/chat-activity'
import type { TranscriptItem } from '../../src/shared/sessions'

const base: ActivityInput = { status: 'working', activity: null, live: [], draft: null }

const bash = (id: string, command: string): TranscriptItem => ({
  kind: 'tool-use',
  id,
  name: 'Bash',
  input: { command },
  line: 1,
  sidechain: false
})
const result = (toolUseId: string): TranscriptItem => ({
  kind: 'tool-result',
  toolUseId,
  text: 'ok',
  isError: false,
  line: 2,
  sidechain: false
})

describe('activityLabel', () => {
  it('estados sin turno: iniciando, esperando permiso o nada', () => {
    expect(activityLabel({ ...base, status: 'starting' })).toBe('Iniciando…')
    expect(activityLabel({ ...base, status: 'waiting' })).toBe('Esperando permiso')
    expect(activityLabel({ ...base, status: 'idle' })).toBeNull()
    expect(activityLabel({ ...base, status: 'closed' })).toBeNull()
  })

  it('actividad del streaming: pensando, escribiendo, preparando o trabajando', () => {
    expect(activityLabel({ ...base, activity: 'thinking' })).toBe('Pensando…')
    expect(activityLabel({ ...base, activity: 'writing' })).toBe('Escribiendo…')
    expect(activityLabel({ ...base, activity: 'tool' })).toBe('Preparando una herramienta…')
    expect(activityLabel(base)).toBe('Trabajando…')
    expect(activityLabel({ ...base, draft: { messageId: 'm', text: 'Hola' } })).toBe('Escribiendo…')
  })

  it('herramienta en curso con su argumento; con resultado ya no cuenta', () => {
    expect(activityLabel({ ...base, live: [bash('a', 'npm test')] })).toBe('Ejecutando npm test')
    expect(activityLabel({ ...base, live: [bash('a', 'npm test'), result('a')] })).toBe(
      'Trabajando…'
    )
    const read: TranscriptItem = {
      kind: 'tool-use',
      id: 'r',
      name: 'Read',
      input: { file_path: 'C:\\p\\src\\a.ts' },
      line: 3,
      sidechain: false
    }
    expect(activityLabel({ ...base, live: [read], cwd: 'C:\\p' })).toBe('Leyendo src\\a.ts')
    const other: TranscriptItem = { ...read, id: 'o', name: 'Rara', input: {} }
    expect(activityLabel({ ...base, live: [other] })).toBe('Usando Rara')
  })

  it('el argumento largo se recorta', () => {
    const label = activityLabel({ ...base, live: [bash('a', 'x'.repeat(200))] }) ?? ''
    expect(label.length).toBeLessThanOrEqual('Ejecutando '.length + 60)
    expect(label.endsWith('…')).toBe(true)
  })
})
