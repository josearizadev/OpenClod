<script setup lang="ts">
import { t } from '../../i18n'
import { SOURCE_LABELS, type SlashEntry } from '../../lib/slash-commands'

/**
 * Autocompletado de comandos (pregunta abierta 6): al escribir `/` al principio del compositor,
 * los comandos que empiezan por lo escrito, con su descripción y, si no los ejecuta Claude Code,
 * quién lo hace (la app o la terminal). El teclado lo lleva el compositor (↑/↓,
 * Enter/Tab, Esc).
 */
defineProps<{
  commands: SlashEntry[]
  active: number
}>()

const emit = defineEmits<{ pick: [name: string]; hover: [index: number] }>()
</script>

<template>
  <ul
    v-if="commands.length > 0"
    id="slash-menu"
    role="listbox"
    :aria-label="t('Comandos')"
    class="flex max-h-60 flex-col overflow-y-auto border-b border-border pb-1"
  >
    <li
      v-for="(command, index) in commands"
      :id="`slash-${index}`"
      :key="command.name"
      role="option"
      :aria-selected="index === active"
      class="flex min-w-0 cursor-default items-baseline gap-2 rounded-item px-2 py-1 text-sm"
      :class="index === active ? 'bg-surface-hover' : ''"
      @mousedown.prevent="emit('pick', command.name)"
      @mousemove="emit('hover', index)"
    >
      <code class="shrink-0 font-mono text-[13px]">/{{ command.name }}</code>
      <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ command.description }}</span>
      <span
        v-if="command.source !== 'claude'"
        class="shrink-0 rounded-[4px] border border-border px-1 text-[11px] leading-4 text-muted"
        :title="
          command.source === 'app'
            ? t('Lo resuelve OpenClod')
            : t('Solo funciona en la terminal de Claude Code')
        "
        >{{ SOURCE_LABELS[command.source] }}</span
      >
    </li>
  </ul>
</template>
