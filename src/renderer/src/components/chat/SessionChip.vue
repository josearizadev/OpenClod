<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next'
import { useCopy } from '../../composables/useCopy'

defineProps<{
  sessionId: string
}>()

const { copied, copy } = useCopy()
</script>

<template>
  <!-- Identificador de la sesión de Claude Code, copiable. -->
  <button
    type="button"
    :title="copied ? 'Copiado' : `Copiar el identificador de sesión ${sessionId}`"
    class="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-item px-2 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
    @click="copy(sessionId)"
  >
    <span class="shrink-0">Sesión</span>
    <code class="truncate font-mono">{{ sessionId }}</code>
    <component
      :is="copied ? Check : Copy"
      class="shrink-0"
      :size="14"
      :stroke-width="1.75"
      aria-hidden="true"
    />
  </button>
</template>
