<script setup lang="ts">
import { Globe } from 'lucide-vue-next'
import { computed } from 'vue'
import type { ChromeState } from '../../../../shared/chat'

/** Claude en Chrome activo en el compositor; abre el diálogo de `/chrome`. */
const props = defineProps<{ chrome: ChromeState }>()
defineEmits<{ open: [] }>()

const title = computed(() =>
  props.chrome.status === 'connected'
    ? 'Claude en Chrome: conectado'
    : props.chrome.status === 'failed'
      ? 'Claude en Chrome: no conecta'
      : 'Claude en Chrome: se conecta al enviar'
)
</script>

<template>
  <button
    type="button"
    class="inline-flex h-8 items-center gap-1.5 rounded-item px-2 text-sm transition-colors duration-150 hover:bg-surface-hover"
    :class="
      chrome.status === 'failed'
        ? 'text-danger'
        : chrome.status === 'connected'
          ? 'text-text'
          : 'text-muted'
    "
    :title="title"
    :aria-label="title"
    @click="$emit('open')"
  >
    <Globe :size="16" :stroke-width="1.75" aria-hidden="true" />
    <span>Chrome</span>
  </button>
</template>
