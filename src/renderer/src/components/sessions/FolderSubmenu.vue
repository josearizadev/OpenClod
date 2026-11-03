<script setup lang="ts">
import { t } from '../../i18n'
import {
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from 'reka-ui'
import { Check, ChevronRight, Folder, FolderPlus, FolderSymlink } from 'lucide-vue-next'
import { computed } from 'vue'
import { useFoldersStore } from '../../stores/folders'
import { useSessionsStore } from '../../stores/sessions'
import SessionLook from './SessionLook.vue'

/**
 * «Mover a carpeta ▸»: las carpetas del proyecto y «Nueva carpeta…». `current` marca la carpeta
 * en la que ya están todas (si es la misma).
 */
const props = defineProps<{
  kind: 'dropdown' | 'context'
  targets: readonly string[]
  current: string | null
}>()

const folders = useFoldersStore()
const sessions = useSessionsStore()

const Sub = computed(() => (props.kind === 'context' ? ContextMenuSub : DropdownMenuSub))
const Trigger = computed(() =>
  props.kind === 'context' ? ContextMenuSubTrigger : DropdownMenuSubTrigger
)
const Content = computed(() =>
  props.kind === 'context' ? ContextMenuSubContent : DropdownMenuSubContent
)
const Portal = computed(() => (props.kind === 'context' ? ContextMenuPortal : DropdownMenuPortal))
const Item = computed(() => (props.kind === 'context' ? ContextMenuItem : DropdownMenuItem))
const Separator = computed(() =>
  props.kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
)

function moveTo(folderId: string): void {
  void sessions.setFolderMany(props.targets, folderId)
}

/** El diálogo se abre con el menú ya cerrado (si no, la vuelta del foco lo cerraría). */
function createNew(): void {
  const ids = [...props.targets]
  setTimeout(() => folders.startCreate(ids), 0)
}

const itemClass =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-60'
</script>

<template>
  <component :is="Sub">
    <component :is="Trigger" :class="[itemClass, 'data-[state=open]:bg-surface-hover']">
      <FolderSymlink :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Mover a carpeta') }}
      <ChevronRight :size="14" :stroke-width="1.75" class="ml-auto text-muted" aria-hidden="true" />
    </component>
    <component :is="Portal">
      <component
        :is="Content"
        :side-offset="4"
        :collision-padding="8"
        class="z-30 max-h-80 min-w-48 overflow-y-auto rounded-menu bg-surface p-1 text-text shadow-float"
      >
        <component
          :is="Item"
          v-for="folder in folders.items"
          :key="folder.id"
          :class="itemClass"
          :disabled="folder.id === current"
          @select="moveTo(folder.id)"
        >
          <SessionLook
            v-if="folder.icon || folder.color"
            :icon="folder.icon"
            :color="folder.color"
            :size="16"
          />
          <Folder v-else :size="16" :stroke-width="1.75" aria-hidden="true" />
          <span class="truncate">{{ folder.name }}</span>
          <Check
            v-if="folder.id === current"
            :size="14"
            :stroke-width="2"
            class="ml-auto text-accent"
            :aria-label="t('Actual')"
          />
        </component>
        <component :is="Separator" v-if="folders.items.length > 0" class="my-1 h-px bg-border" />
        <component :is="Item" :class="itemClass" @select="createNew">
          <FolderPlus :size="16" :stroke-width="1.75" aria-hidden="true" />
          {{ t('Nueva carpeta…') }}
        </component>
      </component>
    </component>
  </component>
</template>
