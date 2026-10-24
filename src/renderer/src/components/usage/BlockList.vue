<script setup lang="ts">
import { t } from '../../i18n'
import type { UsageBlock } from '../../../../shared/usage'
import { formatClock, formatDuration, formatInteger, formatTokens } from '../../lib/usage-format'

// Bloques de 5 h del periodo.
defineProps<{ blocks: UsageBlock[] }>()

function span(b: UsageBlock): string {
  return formatDuration(Date.parse(b.lastMessageAt) - Date.parse(b.start))
}
</script>

<template>
  <section aria-labelledby="usage-blocks">
    <h3 id="usage-blocks" class="mb-2 text-sm font-medium">{{ t('Bloques de 5 horas') }}</h3>
    <p v-if="blocks.length === 0" class="text-sm text-muted">
      {{ t('Sin bloques en este periodo.') }}
    </p>
    <ol v-else class="text-sm">
      <li
        v-for="b in blocks"
        :key="b.start"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-1 py-1.5"
        :class="b.active ? 'bg-surface-hover' : ''"
      >
        <span class="shrink-0 tabular-nums"
          >{{ formatClock(b.start) }} – {{ formatClock(b.end) }}</span
        >
        <span class="text-xs text-muted">{{ t('{time} con actividad', { time: span(b) }) }}</span>
        <span v-if="b.active" class="rounded-full bg-accent px-2 text-xs text-on-accent">{{
          t('Actual')
        }}</span>
        <span v-if="b.limitHit" class="rounded-full border border-danger px-2 text-xs text-danger">
          {{ t('Límite alcanzado') }}
        </span>
        <span
          v-if="b.anchored"
          class="text-xs text-muted"
          :title="t('Inicio tomado de una renovación real de Claude Code')"
        >
          {{ t('Anclado') }}
        </span>
        <span class="ml-auto text-xs text-muted">{{
          t('{n} mens.', { n: formatInteger(b.messages) })
        }}</span>
        <span class="w-16 text-right tabular-nums">{{ formatTokens(b.tokens) }}</span>
      </li>
    </ol>
  </section>
</template>
