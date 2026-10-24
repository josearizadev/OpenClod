<script setup lang="ts">
import { t } from '../../../i18n'
import { computed } from 'vue'
import type { ToolCallView } from '../../../lib/transcript/blocks'
import CodeBlock from '../CodeBlock.vue'
import ToolResult from './ToolResult.vue'

/** `Bash` y `PowerShell`: comando resaltado y salida en mono sin resaltar. */
const props = defineProps<{
  call: ToolCallView
}>()

const input = computed(
  () => (props.call.input ?? {}) as { command?: unknown; description?: unknown }
)
const command = computed(() => (typeof input.value.command === 'string' ? input.value.command : ''))
const description = computed(() =>
  typeof input.value.description === 'string' ? input.value.description : ''
)
const lang = computed(() => (props.call.name === 'PowerShell' ? 'powershell' : 'bash'))
</script>

<template>
  <p v-if="description" class="text-sm text-muted">{{ description }}</p>
  <CodeBlock v-if="command" :code="command" :lang="lang" />
  <ToolResult :call="call" :label="t('Salida')" />
</template>
