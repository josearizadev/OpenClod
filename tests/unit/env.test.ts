import { describe, expect, it } from 'vitest'
import { stripParentClaudeEnv } from '../../src/main/services/env'

describe('stripParentClaudeEnv', () => {
  it('quita los marcadores de una sesión padre y conserva la configuración del usuario', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: 'x',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secreto',
      CLAUDE_CONFIG_DIR: 'D:\\claude',
      CLAUDE_CODE_USE_BEDROCK: '1'
    }
    expect(stripParentClaudeEnv(env)).toBe(3)
    expect(env).toEqual({
      PATH: 'x',
      CLAUDE_CONFIG_DIR: 'D:\\claude',
      CLAUDE_CODE_USE_BEDROCK: '1'
    })
    expect(stripParentClaudeEnv(env)).toBe(0)
  })
})
