<script setup lang="ts">
import { Compass } from 'lucide-vue-next'
import type { Block } from '../../lib/transcript/blocks'
import UserMessage from '../chat/UserMessage.vue'
import MarkdownContent from './MarkdownContent.vue'
import MessageActions from './MessageActions.vue'
import NoticeRow from './NoticeRow.vue'
import SeparatorRow from './SeparatorRow.vue'
import ThinkingLine from './ThinkingLine.vue'
import ToolGroup from './ToolGroup.vue'

/**
 * Un bloque del transcript, según su tipo. Recibe datos de presentación puros
 * (`buildBlocks`), así el chat en vivo lo reutiliza igual.
 */
defineProps<{
  block: Block
  cwd?: string
  /** Sesión a la que pertenecen los subagentes de las llamadas `Agent`. */
  sessionId?: string
}>()
</script>

<template>
  <UserMessage
    v-if="block.kind === 'user'"
    :text="block.text"
    :images="block.images"
    :timestamp="block.timestamp"
    :pending="block.pending"
  />

  <div
    v-else-if="block.kind === 'assistant' && block.streaming"
    class="relative"
    aria-live="polite"
    aria-busy="true"
  >
    <MarkdownContent :source="block.text" streaming />
    <!-- Indicador de escritura: el icono de la app pulsando. -->
    <Compass
      class="mt-1 text-accent motion-safe:animate-pulse"
      :size="18"
      :stroke-width="1.75"
      role="img"
      aria-label="Claude está escribiendo"
    />
  </div>

  <div v-else-if="block.kind === 'assistant'" class="group relative">
    <MarkdownContent :source="block.text" />
    <MessageActions :text="block.text" :timestamp="block.timestamp" label="Copiar respuesta" />
  </div>

  <ThinkingLine v-else-if="block.kind === 'thinking'" :fold-key="block.key" :text="block.text" />

  <ToolGroup v-else-if="block.kind === 'tools'" :block="block" :cwd="cwd" :session-id="sessionId" />

  <SeparatorRow v-else-if="block.kind === 'separator'" :block="block" />

  <NoticeRow v-else :block="block" />
</template>
