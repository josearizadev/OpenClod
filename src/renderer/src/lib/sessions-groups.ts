import type { SessionListItem } from '../../../shared/projects'
import { groupByDate, type DateGroup } from './dates'

/**
 * Grupos de la lista de sesiones: «Favoritas» primero y
 * después los grupos por fecha con el resto. Sin `showHidden`, las ocultas no salen
 * en ningún grupo; con él, salen en su sitio (la fila las muestra atenuadas).
 */
export function groupSessions(
  items: readonly SessionListItem[],
  now: Date,
  showHidden: boolean
): DateGroup<SessionListItem>[] {
  const visible = showHidden ? items : items.filter((item) => !item.hidden)
  const favorites = visible.filter((item) => item.favorite)
  const rest = visible.filter((item) => !item.favorite)
  const groups = groupByDate(rest, now, (item) => item.updatedAt)
  return favorites.length > 0 ? [{ label: 'Favoritas', items: favorites }, ...groups] : groups
}

/** Nº de sesiones ocultas por el usuario en la lista («Mostrar ocultas (N)»). */
export function hiddenCount(items: readonly SessionListItem[]): number {
  return items.filter((item) => item.hidden).length
}
