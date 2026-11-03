import type { SessionListItem } from '../../../shared/projects'
import type { SessionFolder } from '../../../shared/types'
import { groupByDate, type DateGroup } from './dates'
import { t } from '../i18n'

/**
 * Grupos de la lista de sesiones: «Favoritas» primero y
 * después los grupos por fecha con el resto. Las archivadas (`hidden`) no salen en ninguno:
 * con `showArchived` van todas juntas en «Archivadas», al final. Las que están en una carpeta
 * (de `folders`) solo salen en su carpeta (`groupFolders`).
 */
export function groupSessions(
  items: readonly SessionListItem[],
  now: Date,
  showArchived: boolean,
  folders: readonly Pick<SessionFolder, 'id'>[] = []
): DateGroup<SessionListItem>[] {
  const inFolder = new Set(folders.map((f) => f.id))
  const visible = items.filter(
    (item) => !item.hidden && !(item.folderId && inFolder.has(item.folderId))
  )
  const favorites = visible.filter((item) => item.favorite)
  const rest = visible.filter((item) => !item.favorite)
  const groups = groupByDate(rest, now, (item) => item.updatedAt)
  if (favorites.length > 0) groups.unshift({ label: t('Favoritas'), items: favorites })
  const archived = showArchived ? items.filter((item) => item.hidden) : []
  if (archived.length > 0) groups.push({ label: t('Archivadas'), items: archived })
  return groups
}

export interface FolderGroup {
  folder: SessionFolder
  /** Sus sesiones no archivadas, la más reciente primero. */
  items: SessionListItem[]
  /** ISO: la última actividad de sus sesiones o, vacía, su fecha de creación. */
  activity: string
}

/** Carpetas con sus sesiones, la de actividad más reciente primero. */
export function groupFolders(
  items: readonly SessionListItem[],
  folders: readonly SessionFolder[]
): FolderGroup[] {
  const byFolder = new Map<string, SessionListItem[]>(folders.map((f) => [f.id, []]))
  for (const item of items) {
    if (item.hidden || !item.folderId) continue
    byFolder.get(item.folderId)?.push(item)
  }
  return folders
    .map((folder) => {
      const list = [...(byFolder.get(folder.id) ?? [])].sort((a, b) =>
        (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
      )
      const activity = list[0]?.updatedAt ?? folder.createdAt
      return { folder, items: list, activity }
    })
    .sort((a, b) => b.activity.localeCompare(a.activity))
}

/** Nº de sesiones archivadas por el usuario («Archivadas (N)»). */
export function archivedCount(items: readonly SessionListItem[]): number {
  return items.filter((item) => item.hidden).length
}
