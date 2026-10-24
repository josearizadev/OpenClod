<script setup lang="ts">
import { t } from '../../i18n'
import { ChevronRight, CircleAlert, FileSearch, LoaderCircle } from 'lucide-vue-next'
import { computed } from 'vue'
import { useChatContext } from '../../composables/useChatContext'
import { useFoldState } from '../../composables/useFoldState'
import { formatDuration } from '../../lib/dates'
import type { ToolCallView } from '../../lib/transcript/blocks'
import { toolIcon, toolSummary } from '../../lib/transcript/tools'
import CommandOutput from './tools/CommandOutput.vue'
import EditDiff from './tools/EditDiff.vue'
import GenericTool from './tools/GenericTool.vue'
import QuestionTool from './tools/QuestionTool.vue'
import SubagentBlock from './SubagentBlock.vue'
import WriteContent from './tools/WriteContent.vue'

/**
 * Una llamada a herramienta: icono, nombre y argumento principal en mono, con marca de error o
 * de «sin resultado»; al desplegarla, su detalle según la herramienta.
 */
const props = defineProps<{
  call: ToolCallView
  foldKey: string
  cwd?: string
  sessionId?: string
}>()

const fold = useFoldState()
const chat = useChatContext()

/** Ruta del archivo que toca la llamada: se puede abrir en el panel derecho. */
const filePath = computed(() => {
  if (!['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(props.call.name)) return null
  const input = (props.call.input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' ? path : null
})
const open = computed(() => fold.isOpen(props.foldKey))
const summary = computed(() => toolSummary(props.call.name, props.call.input, props.cwd))
const icon = computed(() => toolIcon(props.call.name))

/** Decisión de su tarjeta de permiso. */
const DECISIONS = {
  allowed: { label: t('Permitido'), tone: 'text-muted' },
  always: { label: t('Siempre'), tone: 'text-muted' },
  denied: { label: t('Denegado'), tone: 'text-danger' },
  cancelled: { label: t('Cancelado'), tone: 'text-muted' }
} as const
const decision = computed(() => (props.call.decision ? DECISIONS[props.call.decision] : null))

type Detail = 'edit' | 'write' | 'command' | 'question' | 'output' | 'generic'
const detail = computed<Detail>(() => {
  switch (props.call.name) {
    case 'Edit':
    case 'MultiEdit':
      return 'edit'
    case 'Write':
      return 'write'
    case 'Bash':
    case 'PowerShell':
      return 'command'
    case 'AskUserQuestion':
    case 'ExitPlanMode':
      return 'question'
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'output'
    default:
      return 'generic'
  }
})
</script>

<template>
  <SubagentBlock
    v-if="call.subagent"
    :call="{ ...call, subagent: call.subagent }"
    :fold-key="foldKey"
    :cwd="cwd"
    :session-id="sessionId"
  />
  <div v-else class="group/call relative flex min-w-0 flex-col">
    <button
      v-if="filePath && chat.openFile"
      type="button"
      class="absolute top-1 right-6 rounded-item p-0.5 text-muted opacity-0 transition-opacity duration-150 group-hover/call:opacity-100 hover:text-text focus-visible:opacity-100"
      :title="t('Ver en el panel de archivos')"
      :aria-label="t('Ver en el panel de archivos')"
      @click="chat.openFile(filePath)"
    >
      <FileSearch :size="14" :stroke-width="1.75" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-item py-1 text-left text-sm text-muted hover:text-text"
      :aria-expanded="open"
      @click="fold.toggle(foldKey)"
    >
      <component :is="icon" class="shrink-0" :size="16" :stroke-width="1.75" aria-hidden="true" />
      <span class="shrink-0 font-medium">{{ call.name }}</span>
      <code class="min-w-0 truncate text-[13px]" :title="summary">{{ summary }}</code>
      <span
        v-if="call.status === 'error'"
        class="flex shrink-0 items-center gap-1 text-xs text-danger"
      >
        <CircleAlert :size="14" :stroke-width="1.75" aria-hidden="true" />
        {{ t('Error') }}
      </span>
      <span v-else-if="call.status === 'missing'" class="shrink-0 text-xs text-muted">
        {{ t('sin resultado') }}
      </span>
      <span
        v-else-if="call.status === 'running'"
        class="flex shrink-0 items-center gap-1 text-xs text-muted"
      >
        <LoaderCircle
          class="motion-safe:animate-spin"
          :size="14"
          :stroke-width="1.75"
          aria-hidden="true"
        />
        {{ t('en ejecución')
        }}<template v-if="call.elapsedMs && call.elapsedMs >= 1000">
          · {{ formatDuration(call.elapsedMs) }}</template
        >
      </span>
      <span
        v-if="decision"
        class="shrink-0 rounded-full border border-border px-1.5 text-[11px]"
        :class="decision.tone"
        >{{ decision.label }}</span
      >
      <ChevronRight
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
        class="ml-auto shrink-0 transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-90' : ''"
      />
    </button>

    <div v-if="open" class="flex min-w-0 flex-col gap-2 pt-1 pb-2 pl-6">
      <EditDiff v-if="detail === 'edit'" :call="call" />
      <WriteContent v-else-if="detail === 'write'" :call="call" :cwd="cwd" />
      <CommandOutput v-else-if="detail === 'command'" :call="call" />
      <QuestionTool v-else-if="detail === 'question'" :call="call" />
      <GenericTool v-else :call="call" :show-input="detail === 'generic'" />
    </div>
  </div>
</template>
