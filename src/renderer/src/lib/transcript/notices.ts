/**
 * Textos de los avisos del transcript: Claude Code los guarda con etiquetas
 * pseudo-XML (`<task-notification>`, `<local-command-stdout>`…) que no se muestran tal cual.
 */

function tag(text: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
  return match?.[1]?.trim() || undefined
}

export interface TaskNotice {
  summary: string
  status?: string
  /** «Terminó», «Falló» o «Detenida» según el estado. */
  label?: string
  /** Llamada que lanzó la tarea: el aviso lleva a ella. */
  toolUseId?: string
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Terminó',
  failed: 'Falló',
  killed: 'Detenida',
  stopped: 'Detenida'
}

/** Resumen de una notificación de tarea en segundo plano, su estado y su llamada, si vienen. */
export function taskNotice(text: string): TaskNotice {
  const summary = tag(text, 'summary') ?? stripTags(text).split('\n')[0]?.trim() ?? ''
  const status = tag(text, 'status')
  const label = status ? STATUS_LABELS[status] : undefined
  const toolUseId = tag(text, 'tool-use-id')
  return {
    summary,
    ...(status ? { status } : {}),
    ...(label ? { label } : {}),
    ...(toolUseId ? { toolUseId } : {})
  }
}

/** Quita las etiquetas `<…>` de los avisos de Claude Code y recorta los espacios. */
export function stripTags(text: string): string {
  return text
    .replace(/<\/?[a-z][a-z0-9-]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
