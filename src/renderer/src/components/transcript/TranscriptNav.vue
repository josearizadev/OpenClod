<script setup lang="ts">
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp } from 'lucide-vue-next'
import IconButton from '../ui/IconButton.vue'

/** Botones flotantes del transcript: prompt anterior/siguiente, principio y final. */
defineProps<{
  atStart: boolean
  atEnd: boolean
  hasPrompts: boolean
  /** Hay contenido nuevo por debajo. */
  hasNew?: boolean
}>()

const emit = defineEmits<{ prompt: [direction: -1 | 1]; start: []; end: [] }>()
</script>

<template>
  <div
    class="absolute right-4 bottom-4 flex flex-col gap-0.5 rounded-menu bg-surface p-0.5 shadow-float"
    role="toolbar"
    aria-label="Navegación del transcript"
  >
    <template v-if="hasPrompts">
      <IconButton :icon="ArrowUp" label="Prompt anterior (Alt+↑)" @click="emit('prompt', -1)" />
      <IconButton :icon="ArrowDown" label="Prompt siguiente (Alt+↓)" @click="emit('prompt', 1)" />
    </template>
    <IconButton
      v-if="!atStart"
      :icon="ChevronsUp"
      label="Ir al principio (Inicio)"
      @click="emit('start')"
    />
    <div v-if="!atEnd" class="relative">
      <IconButton
        :icon="ChevronsDown"
        :label="hasNew ? 'Ir al final: hay contenido nuevo (Fin)' : 'Ir al final (Fin)'"
        @click="emit('end')"
      />
      <span
        v-if="hasNew"
        class="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-accent"
        aria-hidden="true"
      />
    </div>
  </div>
</template>
