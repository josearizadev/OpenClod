<script setup lang="ts">
import { ArrowDown } from 'lucide-vue-next'

/** «N mensajes nuevos ↓»: llegó contenido mientras se leía más arriba. */
const props = defineProps<{ count: number }>()
defineEmits<{ go: [] }>()
</script>

<template>
  <button
    type="button"
    class="absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-4 py-1.5 text-sm font-medium whitespace-nowrap text-accent shadow-float hover:text-accent-hover"
    aria-live="polite"
    @click="$emit('go')"
  >
    {{ props.count === 1 ? '1 mensaje nuevo' : `${props.count} mensajes nuevos` }}
    <ArrowDown :size="14" :stroke-width="1.75" aria-hidden="true" />
  </button>
</template>
