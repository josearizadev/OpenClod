<script setup lang="ts">
import { computed } from 'vue'
import type { LimitWindow } from '../../../../shared/usage'
import { useCountdown } from '../../composables/useCountdown'
import { limitView } from '../../lib/limits-view'

// Tarjeta de una ventana de límite.
const props = defineProps<{ title: string; window: LimitWindow | null; empty?: string }>()
const now = useCountdown(() => props.window?.resetsAt)
const view = computed(() => limitView(props.window, now.value, props.title))
const fillClass = computed(() =>
  view.value.tone === 'danger'
    ? 'bg-danger'
    : view.value.tone === 'warning'
      ? 'bg-warning'
      : 'bg-accent'
)
</script>

<template>
  <section class="rounded-menu border border-border bg-surface p-4" :aria-label="title">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-medium">{{ title }}</h3>
      <span
        class="text-2xl tabular-nums"
        :class="
          view.tone === 'danger' ? 'text-danger' : view.tone === 'warning' ? 'text-warning' : ''
        "
        >{{ view.tone === 'empty' ? '—' : view.value || '—' }}</span
      >
    </div>
    <div
      class="mt-3 h-2 overflow-hidden rounded-full bg-meter-track"
      role="meter"
      :aria-label="view.aria"
      :aria-valuenow="view.pct ?? undefined"
      :aria-valuemin="view.pct !== null ? 0 : undefined"
      :aria-valuemax="view.pct !== null ? 100 : undefined"
    >
      <div
        class="h-full rounded-full transition-[width] duration-200"
        :class="[fillClass, view.estimate ? 'opacity-60' : '']"
        :style="{ width: `${Math.round(view.fill * 100)}%` }"
      />
    </div>
    <p class="mt-2 text-sm">
      <template v-if="view.tone === 'empty'">{{ empty ?? 'Sin datos' }}</template>
      <template v-else-if="view.tone === 'danger'">Límite alcanzado · {{ view.resets }}</template>
      <template v-else-if="view.resets">
        {{ view.resets.charAt(0).toUpperCase() + view.resets.slice(1) }} · dentro de
        {{ view.remaining }}
      </template>
    </p>
    <p class="mt-1 text-xs text-muted">{{ view.source }}</p>
  </section>
</template>
