import type { ChatCommand } from '../../../shared/chat'

/**
 * Comandos `/`. Claude Code solo ejecuta por el Agent SDK los
 * que da `supportedCommands()`; los interactivos del terminal responden «isn't available in this
 * environment». Cada comando sale de una de tres fuentes: Claude Code, la app (su equivalente) o
 * la terminal integrada.
 */

export type SlashSource = 'claude' | 'app' | 'terminal'

export interface SlashEntry extends ChatCommand {
  source: SlashSource
}

export type AppCommandId =
  | 'chrome'
  | 'permissions'
  | 'resume'
  | 'help'
  | 'theme'
  | 'memory'
  | 'export'
  | 'copy'
  | 'plan'
  | 'exit'
  | 'new'
  | 'files'
  | 'terminal'

interface AppCommand {
  id: AppCommandId
  name: string
  aliases?: string[]
  description: string
}

/** Comandos que resuelve la app, con el nombre que tienen en Claude Code. */
const APP_COMMANDS: AppCommand[] = [
  { id: 'chrome', name: 'chrome', description: 'Activar o desactivar Claude en Chrome' },
  {
    id: 'permissions',
    name: 'permissions',
    aliases: ['allowed-tools'],
    description: 'Permisos, modo, Git y Chrome del proyecto'
  },
  { id: 'resume', name: 'resume', aliases: ['continue'], description: 'Buscar otra sesión' },
  { id: 'help', name: 'help', description: 'Todos los comandos y cómo se ejecutan' },
  { id: 'theme', name: 'theme', description: 'Tema y demás ajustes de la app' },
  { id: 'memory', name: 'memory', description: 'Editar el CLAUDE.md del proyecto' },
  { id: 'export', name: 'export', description: 'Exportar la conversación a Markdown' },
  { id: 'copy', name: 'copy', description: 'Copiar la última respuesta de Claude' },
  { id: 'plan', name: 'plan', description: 'Pasar a Planificar (con texto, lo envía en ese modo)' },
  { id: 'exit', name: 'exit', aliases: ['quit'], description: 'Cerrar el proceso de esta sesión' },
  { id: 'new', name: 'new', description: 'Empezar una sesión nueva' },
  { id: 'files', name: 'files', description: 'Abrir el panel de archivos' },
  { id: 'terminal', name: 'terminal', description: 'Continuar esta sesión en la terminal' }
]

/**
 * Comandos interactivos de Claude Code (CLI 2.1.3xx) sin equivalente en la app: solo funcionan en
 * la terminal. Sacados de las definiciones del propio binario.
 */
const TERMINAL_COMMANDS: ChatCommand[] = [
  { name: 'add-dir', description: 'Añadir otra carpeta de trabajo' },
  { name: 'artifacts', description: 'Ver los artifacts publicados' },
  { name: 'autofix-pr', description: 'Vigilar y corregir el PR actual' },
  { name: 'background', description: 'Mandar la sesión a segundo plano' },
  { name: 'branch', description: 'Crear una rama de la conversación' },
  { name: 'btw', description: 'Pregunta rápida sin interrumpir' },
  { name: 'bug', description: 'Enviar comentarios o informar de un error' },
  { name: 'cd', description: 'Mover la sesión a otra carpeta' },
  { name: 'cloud-plugins', description: 'Plugins de las sesiones en la nube' },
  { name: 'cost', description: 'Coste de la sesión' },
  { name: 'daemon', description: 'Servicios en segundo plano y rutinas' },
  { name: 'design-login', description: 'Autorizar el acceso a los sistemas de diseño' },
  { name: 'desktop', description: 'Seguir la sesión en Claude Desktop' },
  { name: 'feedback', description: 'Enviar comentarios o informar de un error' },
  { name: 'fork', description: 'Copiar la conversación a una sesión en segundo plano' },
  { name: 'hooks', description: 'Ver los hooks configurados' },
  { name: 'ide', description: 'Integraciones con el IDE' },
  { name: 'install', description: 'Instalar la versión nativa de Claude Code' },
  { name: 'install-github-app', description: 'Configurar Claude en GitHub Actions' },
  { name: 'install-slack-app', description: 'Instalar la app de Slack' },
  { name: 'keybindings', description: 'Atajos de teclado de la terminal' },
  { name: 'login', description: 'Iniciar sesión o cambiar de cuenta' },
  { name: 'logout', description: 'Cerrar la sesión de la cuenta' },
  { name: 'loops', description: 'Bucles programados' },
  { name: 'mobile', description: 'Código QR de la app móvil' },
  { name: 'plugin', description: 'Gestionar plugins' },
  { name: 'powerup', description: 'Lecciones interactivas' },
  { name: 'privacy-settings', description: 'Ajustes de privacidad' },
  { name: 'radio', description: 'Radio lo-fi' },
  { name: 'rate-limit-options', description: 'Opciones al llegar al límite' },
  { name: 'release-notes', description: 'Novedades de Claude Code' },
  { name: 'remote-env', description: 'Entorno de los agentes en la nube' },
  { name: 'scroll-speed', description: 'Velocidad de la rueda del ratón' },
  { name: 'session', description: 'URL de la sesión en la nube' },
  { name: 'setup-bedrock', description: 'Configurar Amazon Bedrock' },
  { name: 'setup-vertex', description: 'Configurar Google Vertex AI' },
  { name: 'skills', description: 'Lista de skills' },
  { name: 'status', description: 'Estado de la cuenta y de la conexión' },
  { name: 'statusline', description: 'Línea de estado de la terminal' },
  { name: 'stickers', description: 'Pedir pegatinas' },
  { name: 'stop', description: 'Parar la sesión en segundo plano' },
  { name: 'subtask', description: 'Enviar un subagente con todo el contexto' },
  { name: 'tasks', description: 'Lo que corre en segundo plano' },
  { name: 'teleport', description: 'Llevar la sesión a la nube' },
  { name: 'terminal-setup', description: 'Configurar Shift+Enter en la terminal' },
  { name: 'tui', description: 'Modo de la interfaz de la terminal' },
  { name: 'upgrade', description: 'Mejorar el plan' },
  { name: 'version', description: 'Versión de Claude Code' },
  { name: 'vim', description: 'Modo Vim del editor' },
  { name: 'voice', description: 'Modo de voz' },
  { name: 'web-setup', description: 'Sesiones en la nube con GitHub' },
  { name: 'wellbeing', description: 'Recordatorios de descanso' },
  { name: 'workflows', description: 'Flujos de trabajo en curso y terminados' }
]

export type SlashAction =
  /** Se manda a Claude Code tal cual (lo ejecuta, o es un comando propio o texto). */
  | { kind: 'claude' }
  | { kind: 'app'; id: AppCommandId; name: string; args: string }
  | { kind: 'terminal'; name: string; description: string }

/** `/nombre args` al principio del mensaje; `null` si no es un comando. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const match = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? { name: match[1] as string, args: (match[2] ?? '').trim() } : null
}

function appCommand(name: string): AppCommand | undefined {
  const key = name.toLowerCase()
  return APP_COMMANDS.find((c) => c.name === key || c.aliases?.includes(key))
}

/**
 * Qué hacer con un mensaje. Lo que Claude Code da por el SDK se le manda; si no, el equivalente
 * de la app; si no, la terminal; el resto (comandos propios que aún no están en el catálogo o un
 * texto que empieza por `/`) también va a Claude Code.
 */
export function classifySlash(text: string, catalog: readonly ChatCommand[]): SlashAction {
  const parsed = parseSlash(text)
  if (!parsed) return { kind: 'claude' }
  const key = parsed.name.toLowerCase()
  // Los de la app tienen el nombre de un comando interactivo: Claude Code nunca los ejecuta.
  const app = appCommand(key)
  if (app) return { kind: 'app', id: app.id, name: app.name, args: parsed.args }
  if (catalog.some((c) => c.name.toLowerCase() === key)) return { kind: 'claude' }
  const terminal = TERMINAL_COMMANDS.find((c) => c.name === key)
  if (terminal) return { kind: 'terminal', name: terminal.name, description: terminal.description }
  return { kind: 'claude' }
}

/** Todo lo del autocompletado, sin repetir nombres. */
export function slashEntries(catalog: readonly ChatCommand[]): SlashEntry[] {
  const out: SlashEntry[] = []
  const seen = new Set<string>()
  const add = (entry: SlashEntry): void => {
    // `__nombre`: internos de Claude Code (p. ej. sesiones lanzadas por un servidor).
    if (seen.has(entry.name) || entry.name.startsWith('__')) return
    seen.add(entry.name)
    out.push(entry)
  }
  for (const c of APP_COMMANDS) add({ name: c.name, description: c.description, source: 'app' })
  for (const c of catalog) add({ name: c.name, description: c.description, source: 'claude' })
  for (const c of TERMINAL_COMMANDS) add({ ...c, source: 'terminal' })
  return out
}

export const SOURCE_LABELS: Record<SlashSource, string> = {
  claude: 'Claude Code',
  app: 'App',
  terminal: 'Terminal'
}
