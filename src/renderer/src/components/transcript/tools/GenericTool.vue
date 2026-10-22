<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCallView } from '../../../lib/transcript/blocks'
import { truncateText } from '../../../lib/transcript/truncate'
import CodeBlock from '../CodeBlock.vue'
import ToolResult from './ToolResult.vue'

/**
 * Cualquier otra herramienta: entrada como JSON con formato y resultado como texto. Con
 * `showInput: false` (Read, Grep, Glob) la ruta o el patrón ya van en la fila: solo la salida.
 */
const props = defineProps<{
  call: ToolCallView
  showInput?: boolean
}>()

const json = computed(() => {
  try {
    return JSON.stringify(props.call.input, null, 2) ?? ''
  } catch {
    return String(props.call.input)
  }
})
// La entrada también se recorta: un JSON enorme no se resalta entero.
const input = computed(() => {
  const cut = truncateText(json.value, { lines: 60, chars: 8000 })
  return cut.truncated ? `${cut.head}\n…` : cut.head
})
</script>

<template>
  <CodeBlock v-if="showInput && json && json !== '{}'" :code="input" lang="json" label="Entrada" />
  <ToolResult :call="call" :label="showInput ? 'Resultado' : 'Salida'" />
</template>
