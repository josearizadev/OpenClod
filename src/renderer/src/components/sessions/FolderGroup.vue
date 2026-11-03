<script setup lang="ts">
import { t } from '../../i18n'
import {
  ContextMenuContent,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { ChevronRight, Ellipsis, Folder, FolderOpen } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { draggedSessions, isSessionsDrag } from '../../lib/session-drag'
import type { FolderGroup } from '../../lib/sessions-groups'
import { useFoldersStore } from '../../stores/folders'
import { useSessionsStore } from '../../stores/sessions'
import FolderMenu from './FolderMenu.vue'
import SessionListItem from './SessionListItem.vue'
import SessionLook from './SessionLook.vue'

/**
 * Carpeta de la lista: cabecera plegable (icono, nombre, nº de sesiones y acciones) y sus
 * sesiones. Soltar sesiones encima las mete en ella.
 */
const props = defineProps<{ group: FolderGroup; now: Date }>()
const emit = defineEmits<{ select: [sessionId: string, range: boolean] }>()

const folders = useFoldersStore()
const sessions = useSessionsStore()

const over = ref(false)
let depth = 0

function onDragEnter(event: DragEvent): void {
  if (!isSessionsDrag(event)) return
  event.preventDefault()
  depth += 1
  over.value = true
}

function onDragOver(event: DragEvent): void {
  if (!isSessionsDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function onDragLeave(): void {
  depth = Math.max(0, depth - 1)
  if (depth === 0) over.value = false
}

function onDrop(event: DragEvent): void {
  depth = 0
  over.value = false
  const ids = draggedSessions(event)
  if (!ids) return
  event.preventDefault()
  // Dentro de la carpeta no se propaga al bloque de «sacar de la carpeta».
  event.stopPropagation()
  const outside = ids.filter(
    (id) => sessions.items.find((i) => i.sessionId === id)?.folderId !== props.group.folder.id
  )
  if (outside.length > 0) void sessions.setFolderMany(outside, props.group.folder.id)
}

// Búsqueda: «enseñar» la carpeta la deja a la vista.
const root = ref<HTMLElement | null>(null)
watch(
  () => folders.revealId,
  async (id) => {
    if (id !== props.group.folder.id) return
    await nextTick()
    root.value?.scrollIntoView({ block: 'nearest' })
    root.value?.querySelector<HTMLElement>('button')?.focus()
    folders.revealId = null
  },
  { immediate: true }
)

const menuContent = 'z-30 min-w-56 rounded-menu bg-surface p-1 text-text shadow-float'
</script>

<template>
  <div
    ref="root"
    class="mt-1 rounded-item transition-colors duration-150"
    :class="over ? 'bg-surface-hover ring-1 ring-accent' : ''"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <ContextMenuRoot>
      <ContextMenuTrigger as-child>
        <div class="group relative">
          <button
            type="button"
            class="no-drag flex h-8 w-full items-center gap-1.5 rounded-item pr-8 pl-1 text-left transition-colors duration-150 hover:bg-surface-hover"
            :aria-expanded="!group.folder.collapsed"
            :title="group.folder.name"
            @click="folders.toggle(group.folder.id)"
          >
            <ChevronRight
              :size="14"
              :stroke-width="1.75"
              class="shrink-0 text-muted transition-transform duration-150"
              :class="group.folder.collapsed ? '' : 'rotate-90'"
              aria-hidden="true"
            />
            <SessionLook
              v-if="group.folder.icon || group.folder.color"
              :icon="group.folder.icon"
              :color="group.folder.color"
              :size="16"
            />
            <component
              :is="group.folder.collapsed ? Folder : FolderOpen"
              v-else
              :size="16"
              :stroke-width="1.75"
              class="shrink-0 text-muted"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate font-medium">{{ group.folder.name }}</span>
            <span
              class="shrink-0 text-xs text-muted tabular-nums"
              :aria-label="t('{n} sesiones', { n: group.items.length })"
              >{{ group.items.length }}</span
            >
          </button>
          <DropdownMenuRoot>
            <DropdownMenuTrigger
              :aria-label="t('Acciones de la carpeta «{name}»', { name: group.folder.name })"
              class="no-drag absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-[6px] text-muted opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-text focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <Ellipsis :size="16" :stroke-width="1.75" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                align="start"
                side="right"
                :side-offset="4"
                :collision-padding="8"
                :class="menuContent"
              >
                <FolderMenu kind="dropdown" :folder="group.folder" />
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent :collision-padding="8" :class="menuContent">
          <FolderMenu kind="context" :folder="group.folder" />
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>

    <ul v-if="!group.folder.collapsed" class="flex flex-col gap-0.5 pb-1 pl-3">
      <li v-for="item in group.items" :key="item.sessionId">
        <SessionListItem
          :item="item"
          :now="now"
          @select="(range: boolean) => emit('select', item.sessionId, range)"
        />
      </li>
      <li v-if="group.items.length === 0" class="px-2 py-1 text-xs text-muted">
        {{ t('Arrastra sesiones aquí o usa «Mover a carpeta».') }}
      </li>
    </ul>
  </div>
</template>
