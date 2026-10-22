<script setup lang="ts">
import { Bell, ChevronRight, CircleSlash, Hourglass, Info, SquareSlash } from 'lucide-vue-next'
import { computed } from 'vue'
import { useChatContext } from '../../composables/useChatContext'
import { useFoldState } from '../../composables/useFoldState'
import { formatDuration } from '../../lib/dates'
import type { Block } from '../../lib/transcript/blocks'
import { stripTags, taskNotice } from '../../lib/transcript/notices'
import TruncatedText from './TruncatedText.vue'

/**
 * Filas compactas del transcript: comando del usuario con su salida,
 * interrupción, notificación de tarea, duración del turno y avisos internos.
 */
const props = defineProps<{
  block: Extract<Block, { kind: 'command' | 'notice' | 'duration' | 'internal' }>
}>()

const fold = useFoldState()
const open = computed(() => fold.isOpen(props.block.key))

const detail = computed<string>(() => {
  const b = props.block
  if (b.kind === 'command') return b.output ? stripTags(b.output.text) : ''
  if (b.kind === 'notice' && b.variant === 'task') return stripTags(b.text)
  if (b.kind === 'internal') return b.text ? stripTags(b.text) : ''
  return ''
})

const chat = useChatContext()

const task = computed(() =>
  props.block.kind === 'notice' && props.block.variant === 'task'
    ? taskNotice(props.block.text)
    : null
)
</script>

<template>
  <!-- Comando: fila mono con su salida plegada debajo. -->
  <div v-if="block.kind === 'command'" class="flex flex-col gap-1 text-sm">
    <button
      type="button"
      class="flex w-fit max-w-full min-w-0 items-center gap-2 rounded-item py-0.5 pr-2 text-muted hover:text-text disabled:hover:text-muted"
      :disabled="!detail"
      :aria-expanded="detail ? open : undefined"
      @click="fold.toggle(block.key)"
    >
      <SquareSlash class="shrink-0" :size="16" :stroke-width="1.75" aria-hidden="true" />
      <code class="min-w-0 truncate text-[13px] text-text"
        >{{ block.name }}<template v-if="block.args"> {{ block.args }}</template></code
      >
      <ChevronRight
        v-if="detail"
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
        class="shrink-0 transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-90' : ''"
      />
    </button>
    <TruncatedText
      v-if="detail && open"
      :text="detail"
      :class="block.output?.stream === 'stderr' ? 'text-danger' : ''"
    />
  </div>

  <!-- Interrupción: aviso centrado. -->
  <p
    v-else-if="block.kind === 'notice' && block.variant === 'interrupted'"
    class="flex items-center justify-center gap-1.5 text-xs text-muted"
  >
    <CircleSlash :size="14" :stroke-width="1.75" aria-hidden="true" />
    Interrumpido por el usuario
  </p>

  <!-- Notificación de tarea en segundo plano: centrada y desplegable. -->
  <div v-else-if="block.kind === 'notice'" class="flex flex-col items-center gap-1 text-xs">
    <button
      type="button"
      class="flex max-w-full min-w-0 items-center gap-1.5 rounded-item px-2 py-0.5 text-muted hover:text-text"
      :aria-expanded="open"
      @click="fold.toggle(block.key)"
    >
      <Bell class="shrink-0" :size="14" :stroke-width="1.75" aria-hidden="true" />
      <span class="min-w-0 truncate" :class="task?.status === 'failed' ? 'text-danger' : ''">
        {{ task?.label ?? 'Notificación de tarea'
        }}<template v-if="task?.summary">: {{ task.summary }}</template>
      </span>
      <ChevronRight
        :size="12"
        :stroke-width="1.75"
        aria-hidden="true"
        class="shrink-0 transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-90' : ''"
      />
    </button>
    <button
      v-if="task?.toolUseId && chat.jumpToTool"
      type="button"
      class="rounded-item px-1 text-muted underline underline-offset-2 hover:text-text"
      @click="chat.jumpToTool(task.toolUseId)"
    >
      Ir a la llamada
    </button>
    <TruncatedText v-if="open" :text="detail" class="w-full" />
  </div>

  <!-- Duración del turno, al final de la respuesta. -->
  <p v-else-if="block.kind === 'duration'" class="flex items-center gap-1.5 text-xs text-muted">
    <Hourglass :size="12" :stroke-width="1.75" aria-hidden="true" />
    Trabajó durante {{ formatDuration(block.ms) }}
  </p>

  <!-- Aviso interno: fila tenue con borde punteado, texto plegado. -->
  <div
    v-else
    class="flex flex-col gap-1 border-l-2 border-dashed border-border pl-2 text-xs text-muted"
  >
    <button
      type="button"
      class="flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-item py-0.5 pr-2 hover:text-text disabled:hover:text-muted"
      :disabled="!detail"
      :aria-expanded="detail ? open : undefined"
      @click="fold.toggle(block.key)"
    >
      <Info class="shrink-0" :size="12" :stroke-width="1.75" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ block.label }}</span>
      <ChevronRight
        v-if="detail"
        :size="12"
        :stroke-width="1.75"
        aria-hidden="true"
        class="shrink-0 transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-90' : ''"
      />
    </button>
    <TruncatedText v-if="detail && open" :text="detail" />
  </div>
</template>
