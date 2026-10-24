<script setup lang="ts">
import { t } from '../../i18n'
import type { SearchGroup } from '../../../../shared/search'
import { relativeTime } from '../../lib/dates'
import { tag } from '../../i18n'
import SnippetText from './SnippetText.vue'

/**
 * Una conversación con sus mejores fragmentos. El título y cada fragmento son
 * opciones del `listbox`: `first` es la del título y `first + 1 + i` la del fragmento `i`.
 */
const props = defineProps<{
  group: SearchGroup
  first: number
  selected: number
  now: Date
}>()
defineEmits<{ pick: [index: number]; hover: [index: number] }>()

const time = (iso?: string): string =>
  iso
    ? new Date(iso).toLocaleString(tag, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    : ''
const count = (): string =>
  props.group.hitCount === 1
    ? t('1 coincidencia')
    : t('{n} coincidencias', { n: props.group.hitCount })
</script>

<template>
  <div class="flex flex-col py-1" role="group" :aria-label="group.title">
    <div
      :id="`busqueda-opcion-${first}`"
      role="option"
      :aria-selected="selected === first"
      class="flex cursor-pointer items-baseline gap-2 rounded-item px-3 py-1.5"
      :class="selected === first ? 'bg-surface-hover' : ''"
      @click="$emit('pick', first)"
      @mousemove="$emit('hover', first)"
    >
      <span class="min-w-0 flex-1 truncate font-medium">
        <SnippetText v-if="group.titleMatch" :parts="group.titleMatch" />
        <template v-else>{{ group.title }}</template>
      </span>
      <span v-if="group.projectName" class="shrink-0 text-xs text-muted">
        {{ group.projectName }}
      </span>
      <span class="shrink-0 text-xs text-muted">{{ relativeTime(group.updatedAt, now) }}</span>
      <span v-if="group.hitCount > 0" class="shrink-0 text-xs text-muted">{{ count() }}</span>
    </div>
    <div
      v-for="(hit, i) in group.hits"
      :id="`busqueda-opcion-${first + 1 + i}`"
      :key="hit.uuid"
      role="option"
      :aria-selected="selected === first + 1 + i"
      class="flex cursor-pointer gap-2 rounded-item py-1 pr-3 pl-6 text-sm"
      :class="selected === first + 1 + i ? 'bg-surface-hover' : ''"
      @click="$emit('pick', first + 1 + i)"
      @mousemove="$emit('hover', first + 1 + i)"
    >
      <span class="w-12 shrink-0 text-muted">{{ hit.role === 'user' ? t('Tú') : 'Claude' }}</span>
      <span class="line-clamp-2 min-w-0 flex-1"><SnippetText :parts="hit.snippet" /></span>
      <span class="shrink-0 text-xs text-muted">{{ time(hit.timestamp) }}</span>
    </div>
  </div>
</template>
