<script setup lang="ts">
import { t } from '../../i18n'
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
    :title="copied ? t('Copiado') : t('Copiar el identificador de sesión {id}', { id: sessionId })"
    class="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-item px-2 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
    @click="copy(sessionId)"
  >
    <span class="shrink-0">{{ t('Sesión') }}</span>
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
