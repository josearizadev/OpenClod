/**
 * Operaciones de archivos en un comando de `Bash`/`PowerShell`. Solo
 * se reconocen formas simples y fiables: `rm`, `del`, `Remove-Item`, `touch`, `mv`, `git mv` y
 * `Move-Item` con rutas literales. Con comodines, variables, varios comandos (`;`, `&&`, `|`) o
 * redirecciones no se devuelve nada: lo que no se detecta con seguridad no se lista.
 */

export type ShellFileOp =
  | { op: 'deleted'; path: string }
  | { op: 'created'; path: string }
  | { op: 'moved'; from: string; to: string }

/** Caracteres que hacen el comando ambiguo. */
const UNSAFE = /[;&|<>`$*?{}[\]()]|\n/

/** Divide en palabras respetando comillas simples y dobles; `null` si no se puede. */
function words(command: string): string[] | null {
  const out: string[] = []
  // `y`: cada palabra empieza donde acabó la anterior (una comilla sin cerrar no se salta).
  const re = /\s*(?:'([^']*)'|"([^"]*)"|([^\s'"]+))/y
  let match: RegExpExecArray | null
  let consumed = 0
  while ((match = re.exec(command)) !== null) {
    if (match[0].trim() === '') break
    out.push(match[1] ?? match[2] ?? match[3] ?? '')
    consumed = re.lastIndex
  }
  return command.slice(consumed).trim() === '' ? out : null
}

function isFlag(word: string): boolean {
  return /^-{1,2}[A-Za-z][\w-]*$/.test(word)
}

/** Opciones de PowerShell que llevan valor y cuyo valor no es una ruta. */
const PS_VALUE_FLAGS = new Set(['-itemtype', '-type'])

function paths(args: string[]): string[] | null {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (isFlag(arg)) {
      const lower = arg.toLowerCase()
      if (lower === '-path' || lower === '-literalpath' || lower === '-destination') continue
      if (PS_VALUE_FLAGS.has(lower)) return null
      continue
    }
    if (arg === '' || arg === '.' || arg === '..' || arg === '/' || /^[A-Za-z]:\\?$/.test(arg))
      return null
    out.push(arg)
  }
  return out
}

export function shellFileOps(command: string): ShellFileOp[] {
  const text = command.trim()
  if (!text || UNSAFE.test(text)) return []
  const parts = words(text)
  if (!parts || parts.length < 2) return []
  const [name, ...rest] = parts as [string, ...string[]]
  let args = rest
  let lower = name.toLowerCase()
  if (lower === 'git' && args[0] === 'mv') {
    lower = 'git mv'
    args = args.slice(1)
  }
  const list = paths(args)
  if (!list || list.length === 0) return []

  switch (lower) {
    case 'rm':
    case 'del':
    case 'remove-item':
    case 'ri':
      return list.map((path) => ({ op: 'deleted' as const, path }))
    case 'touch':
      return list.map((path) => ({ op: 'created' as const, path }))
    case 'mv':
    case 'git mv':
    case 'move-item':
    case 'move':
      if (list.length !== 2) return []
      return [{ op: 'moved', from: list[0] as string, to: list[1] as string }]
    default:
      return []
  }
}
