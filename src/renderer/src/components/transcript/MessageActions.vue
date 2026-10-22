<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next'
import { computed } from 'vue'
import { useCopy } from '../../composables/useCopy'
import { longDateTime, timeOfDay } from '../../lib/dates'

/**
 * Hora y «Copiar» de un mensaje. Visibles al pasar el ratón o con el foco: el
 * contenedor lleva `group relative`. Flotan en el hueco bajo el mensaje (`top-full`), así no
 * reservan una fila propia y el espaciado entre bloques es el mismo con o sin acciones.
 */
const props = defineProps<{
  text: string
  timestamp?: string
  label: string
  align?: 'start' | 'end'
}>()

const { copied, copy } = useCopy()
const time = computed(() => timeOfDay(props.timestamp))
</script>

<template>
  <div
    class="absolute top-full z-10 flex h-6 items-center gap-1 text-xs text-muted opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
    :class="align === 'end' ? 'right-0' : 'left-0'"
  >
    <time v-if="time" :datetime="timestamp" :title="longDateTime(timestamp)" class="px-1">
      {{ time }}
    </time>
    <button
      type="button"
      :aria-label="copied ? 'Copiado' : label"
      :title="copied ? 'Copiado' : label"
      class="inline-flex size-6 items-center justify-center rounded-[6px] transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      @click="copy(props.text)"
    >
      <component :is="copied ? Check : Copy" :size="14" :stroke-width="1.75" />
    </button>
  </div>
</template>
