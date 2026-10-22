/**
 * Variables que deja un proceso padre de Claude Code (p. ej. al lanzar `npm run dev` desde una
 * sesión). Si llegan a los procesos de Claude Code de la app (chat, sonda, terminal), la CLI se
 * cree una sesión hija y no guarda la transcripción («Transcript saving is off»), y una de ellas
 * es un token. La configuración del usuario (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_USE_BEDROCK`…) se
 * conserva.
 */
const PARENT_CLAUDE_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT'
] as const

/** Quita los marcadores de `env` (lo modifica) y devuelve cuántos había. */
export function stripParentClaudeEnv(env: NodeJS.ProcessEnv): number {
  let removed = 0
  for (const key of PARENT_CLAUDE_MARKERS) {
    if (key in env) {
      delete env[key]
      removed++
    }
  }
  return removed
}
