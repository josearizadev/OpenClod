/**
 * Sesión de Claude Code según `claude auth status`. `unknown`: no se pudo consultar (binario
 * ausente, tiempo agotado o salida inesperada). Nunca lleva credenciales ni ids de organización.
 */
export interface AuthStatus {
  state: 'in' | 'out' | 'unknown'
  /** «claude.ai», «console», «api_key»… tal como lo da Claude Code. */
  method?: string
  email?: string
  /** «pro», «max», «team»… */
  plan?: string
  /** `firstParty`, `bedrock`, `vertex`… */
  provider?: string
}
