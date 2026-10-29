<script setup lang="ts">
import { t } from '../../i18n'
import { File, Folder } from 'lucide-vue-next'
import type { MentionEntry } from '../../../../shared/files'

/**
 * Sugerencias de `@`: archivos y carpetas de la carpeta de trabajo que coinciden con lo escrito,
 * con el nombre delante y su carpeta atenuada. El teclado lo lleva el compositor.
 */
defineProps<{
  entries: MentionEntry[]
  active: number
}>()

const emit = defineEmits<{ pick: [entry: MentionEntry]; hover: [index: number] }>()

function split(path: string): { name: string; parent: string } {
  const cut = path.lastIndexOf('/')
  return { name: path.slice(cut + 1), parent: cut > 0 ? path.slice(0, cut) : '' }
}
</script>

<template>
  <ul
    v-if="entries.length > 0"
    id="mention-menu"
    role="listbox"
    :aria-label="t('Archivos')"
    class="flex max-h-60 flex-col overflow-y-auto border-b border-border pb-1"
  >
    <li
      v-for="(entry, index) in entries"
      :id="`mention-${index}`"
      :key="entry.path"
      role="option"
      :aria-selected="index === active"
      class="flex min-w-0 cursor-default items-center gap-2 rounded-item px-2 py-1 text-sm"
      :class="index === active ? 'bg-surface-hover' : ''"
      :title="entry.path"
      @mousedown.prevent="emit('pick', entry)"
      @mousemove="emit('hover', index)"
    >
      <component
        :is="entry.dir ? Folder : File"
        :size="14"
        :stroke-width="1.75"
        class="shrink-0 text-muted"
        aria-hidden="true"
      />
      <span class="shrink-0 font-mono text-[13px]"
        >{{ split(entry.path).name }}{{ entry.dir ? '/' : '' }}</span
      >
      <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ split(entry.path).parent }}</span>
    </li>
  </ul>
</template>
