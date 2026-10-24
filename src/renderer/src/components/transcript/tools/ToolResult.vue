<script setup lang="ts">
import { t } from '../../../i18n'
import type { ToolCallView } from '../../../lib/transcript/blocks'
import TruncatedText from '../TruncatedText.vue'

/** Resultado de una llamada, recortado; en `--danger` si es un error. */
defineProps<{
  call: ToolCallView
  label?: string
}>()
</script>

<template>
  <!-- En curso (o vista previa de un permiso): aún no hay resultado que mostrar. -->
  <template v-if="!call.result && call.status === 'running'" />
  <p v-else-if="!call.result" class="text-xs text-muted">
    {{ t('Sin resultado: la llamada no terminó.') }}
  </p>
  <div v-else-if="call.result.text" class="flex min-w-0 flex-col gap-1">
    <p class="text-xs" :class="call.result.isError ? 'text-danger' : 'text-muted'">
      {{ call.result.isError ? t('Error') : (label ?? t('Resultado')) }}
    </p>
    <TruncatedText :text="call.result.text" :class="call.result.isError ? 'text-danger' : ''" />
  </div>
  <p v-else class="text-xs text-muted">Sin salida.</p>
</template>
