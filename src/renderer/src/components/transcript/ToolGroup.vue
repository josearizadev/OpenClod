<script setup lang="ts">
import { t } from '../../i18n'
import { ChevronRight, CircleAlert, LoaderCircle } from 'lucide-vue-next'
import { computed } from 'vue'
import { useFoldState } from '../../composables/useFoldState'
import type { Block } from '../../lib/transcript/blocks'
import { groupLabel } from '../../lib/transcript/tools'
import ThinkingLine from './ThinkingLine.vue'
import ToolCall from './ToolCall.vue'

/**
 * Grupo de actividad: el thinking y las llamadas que hay entre un
 * texto y el siguiente. Con una sola llamada, su fila; si no, una fila resumen plegada («Pensó,
 * leyó 3 archivos y ejecutó 2 comandos») que despliega cada paso en orden.
 */
const props = defineProps<{
  block: Extract<Block, { kind: 'tools' }>
  cwd?: string
  sessionId?: string
}>()

const fold = useFoldState()
const open = computed(() => fold.isOpen(props.block.key))
const thought = computed(() => props.block.steps.some((s) => s.kind === 'thinking'))
const label = computed(() => groupLabel(props.block.calls, { thought: thought.value }))
const errors = computed(() => props.block.calls.filter((c) => c.status === 'error').length)
const running = computed(() => props.block.calls.some((c) => c.status === 'running'))
const single = computed(() => props.block.steps.length === 1 && props.block.calls.length === 1)
</script>

<template>
  <ToolCall
    v-if="single && block.calls[0]"
    :call="block.calls[0]"
    :fold-key="`${block.key}/${block.calls[0].id}`"
    :cwd="cwd"
    :session-id="sessionId"
  />
  <div v-else class="flex flex-col">
    <button
      type="button"
      class="flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-item py-1 pr-2 text-sm text-muted hover:text-text"
      :aria-expanded="open"
      @click="fold.toggle(block.key)"
    >
      <ChevronRight
        :size="16"
        :stroke-width="1.75"
        aria-hidden="true"
        class="shrink-0 transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-90' : ''"
      />
      <span class="min-w-0 truncate">{{ label }}</span>
      <LoaderCircle
        v-if="running"
        class="shrink-0 motion-safe:animate-spin"
        :size="14"
        :stroke-width="1.75"
        role="img"
        :aria-label="t('en ejecución')"
      />
      <span v-if="errors" class="flex shrink-0 items-center gap-1 text-danger">
        <CircleAlert :size="14" :stroke-width="1.75" aria-hidden="true" />
        {{ errors === 1 ? t('1 error') : t('{n} errores', { n: errors }) }}
      </span>
    </button>
    <div v-if="open" class="ml-2 flex flex-col border-l border-border pl-3">
      <template v-for="step in block.steps" :key="step.kind === 'call' ? step.call.id : step.key">
        <ThinkingLine
          v-if="step.kind === 'thinking'"
          :fold-key="`${block.key}/${step.key}`"
          :text="step.text"
        />
        <ToolCall
          v-else
          :call="step.call"
          :fold-key="`${block.key}/${step.call.id}`"
          :cwd="cwd"
          :session-id="sessionId"
        />
      </template>
    </div>
  </div>
</template>
