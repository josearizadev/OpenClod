/**
 * Recorte de salidas y entradas largas de las herramientas. Se
 * aplica en el renderer: el main manda el texto completo y «Mostrar todo» no necesita otra
 * petición.
 */

export interface Truncated {
  head: string
  totalLines: number
  truncated: boolean
}

const TRUNCATE_LIMITS = { lines: 20, chars: 4000 }

export function truncateText(
  text: string,
  limits: { lines: number; chars: number } = TRUNCATE_LIMITS
): Truncated {
  const lines = text.split('\n')
  const totalLines = lines.length
  let head = text
  if (totalLines > limits.lines) head = lines.slice(0, limits.lines).join('\n')
  if (head.length > limits.chars) {
    // Se corta en el último salto de línea antes del límite, si lo hay.
    const cut = head.lastIndexOf('\n', limits.chars)
    head = head.slice(0, cut > limits.chars / 2 ? cut : limits.chars)
  }
  return { head, totalLines, truncated: head.length < text.length }
}
