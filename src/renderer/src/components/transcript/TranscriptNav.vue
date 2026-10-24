<script setup lang="ts">
import { t } from '../../i18n'
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
    :aria-label="t('Navegación del transcript')"
  >
    <template v-if="hasPrompts">
      <IconButton
        :icon="ArrowUp"
        :label="t('Prompt anterior (Alt+↑)')"
        @click="emit('prompt', -1)"
      />
      <IconButton
        :icon="ArrowDown"
        :label="t('Prompt siguiente (Alt+↓)')"
        @click="emit('prompt', 1)"
      />
    </template>
    <IconButton
      v-if="!atStart"
      :icon="ChevronsUp"
      :label="t('Ir al principio (Inicio)')"
      @click="emit('start')"
    />
    <div v-if="!atEnd" class="relative">
      <IconButton
        :icon="ChevronsDown"
        :label="hasNew ? t('Ir al final: hay contenido nuevo (Fin)') : t('Ir al final (Fin)')"
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
