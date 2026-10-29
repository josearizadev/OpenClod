import type { SessionListItem } from '../../../shared/projects'
import { groupByDate, type DateGroup } from './dates'
import { t } from '../i18n'

/**
 * Grupos de la lista de sesiones: «Favoritas» primero y
 * después los grupos por fecha con el resto. Las archivadas (`hidden`) no salen en ninguno:
 * con `showArchived` van todas juntas en «Archivadas», al final.
 */
export function groupSessions(
  items: readonly SessionListItem[],
  now: Date,
  showArchived: boolean
): DateGroup<SessionListItem>[] {
  const visible = items.filter((item) => !item.hidden)
  const favorites = visible.filter((item) => item.favorite)
  const rest = visible.filter((item) => !item.favorite)
  const groups = groupByDate(rest, now, (item) => item.updatedAt)
  if (favorites.length > 0) groups.unshift({ label: t('Favoritas'), items: favorites })
  const archived = showArchived ? items.filter((item) => item.hidden) : []
  if (archived.length > 0) groups.push({ label: t('Archivadas'), items: archived })
  return groups
}

/** Nº de sesiones archivadas por el usuario («Archivadas (N)»). */
export function archivedCount(items: readonly SessionListItem[]): number {
  return items.filter((item) => item.hidden).length
}
