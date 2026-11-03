<script setup lang="ts">
import { t } from '../../i18n'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSeparator
} from 'reka-ui'
import { Pencil, SquarePen, Trash2 } from 'lucide-vue-next'
import { computed } from 'vue'
import type { SessionFolder } from '../../../../shared/types'
import { useFoldersStore } from '../../stores/folders'

/** Acciones de una carpeta: Nueva sesión en esta carpeta · Editar… · Eliminar…. */
const props = defineProps<{ kind: 'dropdown' | 'context'; folder: SessionFolder }>()

const folders = useFoldersStore()

const Item = computed(() => (props.kind === 'context' ? ContextMenuItem : DropdownMenuItem))
const Separator = computed(() =>
  props.kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
)

/** Los diálogos se abren con el menú ya cerrado (si no, la vuelta del foco los cerraría). */
function edit(): void {
  setTimeout(() => folders.startEdit(props.folder), 0)
}

function askRemove(): void {
  setTimeout(() => (folders.removing = props.folder), 0)
}

const itemClass =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <component :is="Item" :class="itemClass" @select="folders.newSessionIn(folder.id)">
    <SquarePen :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Nueva sesión en esta carpeta') }}
  </component>
  <component :is="Item" :class="itemClass" @select="edit">
    <Pencil :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Editar carpeta…') }}
  </component>
  <component :is="Separator" class="my-1 h-px bg-border" />
  <component :is="Item" :class="[itemClass, 'text-danger']" @select="askRemove">
    <Trash2 :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Eliminar carpeta…') }}
  </component>
</template>
