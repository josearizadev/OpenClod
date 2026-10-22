import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '../../src/shared/sessions'
import { MAX_SEARCH_TEXT, searchTextOf } from '../../src/main/services/search-text'

const base = { line: 3, uuid: 'u1', timestamp: '2026-10-01T00:00:00Z', sidechain: false }

describe('searchTextOf', () => {
  it('entran prompts reales y respuestas', () => {
    expect(searchTextOf({ ...base, kind: 'user-prompt', text: ' Hola ', images: 0 })).toEqual({
      uuid: 'u1',
      role: 'user',
      timestamp: base.timestamp,
      line: 3,
      text: 'Hola'
    })
    expect(searchTextOf({ ...base, kind: 'assistant-text', text: 'Respuesta' })?.role).toBe(
      'assistant'
    )
  })

  it.each<TranscriptItem>([
    { ...base, kind: 'thinking', text: 'pienso' },
    { ...base, kind: 'command', name: '/model', args: '' },
    { ...base, kind: 'meta', text: 'aviso interno' },
    { ...base, kind: 'tool-use', id: 't', name: 'Bash', input: {} },
    { ...base, kind: 'tool-result', toolUseId: 't', isError: false, text: 'salida' },
    { ...base, kind: 'attachment', attachmentType: 'file' },
    { ...base, kind: 'assistant-text', text: '   ' },
    { ...base, sidechain: true, kind: 'assistant-text', text: 'de un subagente' },
    { line: 1, sidechain: false, kind: 'assistant-text', text: 'sin uuid' }
  ])('no entra: $kind', (item) => {
    expect(searchTextOf(item)).toBeNull()
  })

  it('recorta a 32.000 caracteres', () => {
    const text = 'a'.repeat(MAX_SEARCH_TEXT + 10)
    expect(searchTextOf({ ...base, kind: 'assistant-text', text })?.text).toHaveLength(
      MAX_SEARCH_TEXT
    )
  })
})
