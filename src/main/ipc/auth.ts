import type { AuthStatus } from '../../shared/auth'
import { handle } from './handle'

/** Estado de la sesión de Claude Code (bienvenida, Ajustes). */
export function registerAuthIpc(status: () => Promise<AuthStatus>): void {
  handle('auth:status', () => status())
}
