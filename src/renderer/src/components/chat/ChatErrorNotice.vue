<script setup lang="ts">
import { ChevronRight, TriangleAlert } from 'lucide-vue-next'
import { ref } from 'vue'
import type { ChatErrorView } from '../../../../shared/chat'

/**
 * Error de un turno o de Claude Code: mensaje en español y detalle técnico plegable.
 * Nunca pide ni muestra credenciales.
 */
defineProps<{ error: ChatErrorView }>()
const emit = defineEmits<{ dismiss: [] }>()
const open = ref(false)
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded-item border border-danger/40 bg-surface px-3 py-2 text-sm"
    role="alert"
  >
    <div class="flex items-start gap-2">
      <TriangleAlert
        class="mt-0.5 shrink-0 text-danger"
        :size="16"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      <p class="min-w-0 flex-1">{{ error.message }}</p>
      <button
        type="button"
        class="shrink-0 rounded-item px-1 text-xs text-muted hover:text-text"
        @click="emit('dismiss')"
      >
        Cerrar
      </button>
    </div>
    <button
      v-if="error.detail"
      type="button"
      class="flex w-fit items-center gap-1 rounded-item pl-6 text-xs text-muted hover:text-text"
      :aria-expanded="open"
      @click="open = !open"
    >
      <ChevronRight
        :size="12"
        :stroke-width="1.75"
        aria-hidden="true"
        class="transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-90' : ''"
      />
      Detalle técnico
    </button>
    <pre
      v-if="open && error.detail"
      class="ml-6 max-h-48 overflow-auto rounded-item bg-code-bg p-2 font-mono text-xs whitespace-pre-wrap"
      >{{ error.detail }}</pre>
  </div>
</template>
