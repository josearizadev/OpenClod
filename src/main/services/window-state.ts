/**
 * Tamaño y posición de la ventana entre ejecuciones. Puro: recibe las
 * pantallas y devuelve dónde abrir la ventana.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindow extends Rect {
  maximized: boolean
}

const MIN_SIZE = { width: 900, height: 600 } as const
const DEFAULT_SIZE = { width: 1280, height: 820 } as const
/** Mínimo visible para dar por buena la posición guardada. */
const VISIBLE = { width: 100, height: 50 } as const

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number)
  )
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

function clampSize(width: number, height: number, area: Rect): { width: number; height: number } {
  return {
    width: Math.round(Math.max(MIN_SIZE.width, Math.min(width, area.width))),
    height: Math.round(Math.max(MIN_SIZE.height, Math.min(height, area.height)))
  }
}

function centered(size: { width: number; height: number }, area: Rect): Rect {
  return {
    ...size,
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2)
  }
}

/**
 * Dónde abrir la ventana: la posición guardada si sigue viéndose en alguna pantalla (con el tamaño
 * acotado a su área de trabajo); si no, centrada en la principal con el tamaño guardado.
 */
export function restoreBounds(
  saved: unknown,
  workAreas: Rect[],
  primary: Rect
): { bounds: Rect; maximized: boolean } {
  const maximized =
    typeof saved === 'object' && saved !== null && (saved as SavedWindow).maximized === true
  if (!isRect(saved)) {
    return {
      bounds: centered(clampSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height, primary), primary),
      maximized: false
    }
  }
  const area = workAreas.find((a) => {
    const o = overlap(saved, a)
    return o.width >= VISIBLE.width && o.height >= VISIBLE.height
  })
  if (!area) {
    return { bounds: centered(clampSize(saved.width, saved.height, primary), primary), maximized }
  }
  const size = clampSize(saved.width, saved.height, area)
  // Que la barra de título quede dentro del área de trabajo.
  const x = Math.round(
    Math.min(
      Math.max(saved.x, area.x - size.width + VISIBLE.width),
      area.x + area.width - VISIBLE.width
    )
  )
  const y = Math.round(Math.min(Math.max(saved.y, area.y), area.y + area.height - VISIBLE.height))
  return { bounds: { x, y, ...size }, maximized }
}
