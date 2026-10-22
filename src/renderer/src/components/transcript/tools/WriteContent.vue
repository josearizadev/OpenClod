<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallView } from '../../../lib/transcript/blocks'
import { languageOf, relativePath } from '../../../lib/transcript/tools'
import { truncateText } from '../../../lib/transcript/truncate'
import CodeBlock from '../CodeBlock.vue'
import ToolResult from './ToolResult.vue'

/** `Write`: contenido nuevo del archivo resaltado según su extensión. */
const props = defineProps<{
  call: ToolCallView
  cwd?: string
}>()

const input = computed(() => (props.call.input ?? {}) as { file_path?: unknown; content?: unknown })
const path = computed(() =>
  typeof input.value.file_path === 'string' ? input.value.file_path : ''
)
const content = computed(() => (typeof input.value.content === 'string' ? input.value.content : ''))
const showAll = ref(false)
const cut = computed(() => truncateText(content.value, { lines: 40, chars: 8000 }))
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <CodeBlock
      :code="showAll ? content : cut.head"
      :lang="languageOf(path)"
      :label="relativePath(path, cwd) || 'Archivo nuevo'"
    />
    <button
      v-if="cut.truncated"
      type="button"
      class="w-fit rounded-item px-1 text-xs text-muted underline underline-offset-2 hover:text-text"
      :aria-expanded="showAll"
      @click="showAll = !showAll"
    >
      {{ showAll ? 'Mostrar menos' : `Mostrar todo (${cut.totalLines} líneas)` }}
    </button>
  </div>
  <ToolResult v-if="!call.result || call.result.isError" :call="call" />
</template>
