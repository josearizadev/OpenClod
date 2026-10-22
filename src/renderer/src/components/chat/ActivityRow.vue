<script setup lang="ts">
import { Compass } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatDuration } from '../../lib/dates'

/**
 * Lo que hace Claude, al final del transcript mientras trabaja: el icono de
 * la app pulsando, «Pensando…» o la herramienta en curso, y el tiempo del turno.
 */
const props = defineProps<{
  label: string
  /** Inicio del turno (ms), o `null` si aún no ha empezado. */
  startedAt: number | null
}>()

const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(timer))

const elapsed = computed(() =>
  props.startedAt !== null && now.value - props.startedAt >= 1000
    ? formatDuration(now.value - props.startedAt)
    : null
)
</script>

<template>
  <p class="flex min-w-0 items-center gap-2 py-1 text-sm text-muted" role="status">
    <Compass
      class="shrink-0 text-accent motion-safe:animate-pulse"
      :size="18"
      :stroke-width="1.75"
      aria-hidden="true"
    />
    <span class="min-w-0 truncate" :title="label">{{ label }}</span>
    <span v-if="elapsed" class="shrink-0 tabular-nums">· {{ elapsed }}</span>
  </p>
</template>
