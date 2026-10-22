<script setup lang="ts">
import { ChevronDown, ChevronUp, X } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import IconButton from '../ui/IconButton.vue'

/**
 * Buscar en la sesión (`Ctrl+F`). `Enter`/`F3` = siguiente,
 * `Shift+Enter`/`Shift+F3` = anterior, `Esc` cierra (la vista devuelve el foco al transcript).
 */
const query = defineModel<string>({ required: true })
defineProps<{ current: number; total: number }>()
const emit = defineEmits<{ next: []; previous: []; close: [] }>()
const input = ref<HTMLInputElement | null>(null)

onMounted(() => input.value?.select())
defineExpose({ focus: () => input.value?.select() })

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === 'F3') {
    event.preventDefault()
    if (event.shiftKey) emit('previous')
    else emit('next')
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <div
    class="absolute top-2 right-6 z-20 flex items-center gap-1 rounded-item bg-surface py-1 pr-1 pl-3 shadow-float"
    role="search"
    aria-label="Buscar en la sesión"
  >
    <input
      ref="input"
      v-model="query"
      type="text"
      maxlength="200"
      placeholder="Buscar en la sesión"
      aria-label="Buscar en la sesión"
      class="h-7 w-56 bg-transparent text-sm outline-none placeholder:text-muted"
      @keydown="onKeydown"
    />
    <span class="min-w-16 text-right text-xs text-muted tabular-nums" aria-live="polite">
      {{ query.trim() ? (total ? `${current} de ${total}` : 'Sin resultados') : '' }}
    </span>
    <IconButton
      :icon="ChevronUp"
      label="Anterior (Mayús+Intro)"
      :disabled="total === 0"
      @click="emit('previous')"
    />
    <IconButton
      :icon="ChevronDown"
      label="Siguiente (Intro)"
      :disabled="total === 0"
      @click="emit('next')"
    />
    <IconButton :icon="X" label="Cerrar (Esc)" @click="emit('close')" />
  </div>
</template>
