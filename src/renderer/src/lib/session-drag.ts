/** Tipo propio de `dataTransfer` al arrastrar sesiones de la lista: JSON con sus ids. */
export const SESSIONS_DRAG_TYPE = 'application/x-openclod-sessions'

/** Ids arrastrados, o `null` si no es un arrastre de sesiones (o está mal formado). */
export function draggedSessions(event: DragEvent): string[] | null {
  const raw = event.dataTransfer?.getData(SESSIONS_DRAG_TYPE)
  if (!raw) return null
  try {
    const ids: unknown = JSON.parse(raw)
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : null
  } catch {
    return null
  }
}

/** Durante el arrastre solo se ve el tipo, no los datos. */
export function isSessionsDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(SESSIONS_DRAG_TYPE) === true
}
