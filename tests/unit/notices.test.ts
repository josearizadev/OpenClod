import { describe, expect, it } from 'vitest'
import { stripTags, taskNotice } from '../../src/renderer/src/lib/transcript/notices'

describe('avisos del transcript', () => {
  it('taskNotice: resumen y estado de la notificación', () => {
    const text =
      '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "npm test" completed</summary>\n</task-notification>'
    expect(taskNotice(text)).toEqual({
      summary: 'Background command "npm test" completed',
      status: 'completed',
      label: 'Terminó'
    })
    expect(taskNotice('Texto suelto\nsegunda')).toEqual({ summary: 'Texto suelto' })
  })

  it('«Terminó / Falló / Detenida» y la llamada que la lanzó', () => {
    const notice = (status: string): string =>
      `<task-notification>
<task-id>b1</task-id>
<tool-use-id>toolu_01X</tool-use-id>
<status>${status}</status>
<summary>Tarea</summary>
</task-notification>`
    expect(taskNotice(notice('completed'))).toMatchObject({
      label: 'Terminó',
      toolUseId: 'toolu_01X'
    })
    expect(taskNotice(notice('failed')).label).toBe('Falló')
    expect(taskNotice(notice('killed')).label).toBe('Detenida')
    expect(taskNotice(notice('stopped')).label).toBe('Detenida')
    expect(taskNotice(notice('raro'))).not.toHaveProperty('label')
  })

  it('stripTags quita las etiquetas de Claude Code', () => {
    expect(stripTags('<local-command-stdout>Hecho</local-command-stdout>')).toBe('Hecho')
    expect(stripTags('a < b y c > d')).toBe('a < b y c > d')
  })
})
