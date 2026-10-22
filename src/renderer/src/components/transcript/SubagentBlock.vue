<script setup lang="ts">
import { Bot, ChevronRight } from 'lucide-vue-next'
import { computed, ref, shallowRef, watch } from 'vue'
import type { TranscriptItem } from '../../../../shared/sessions'
import { useChatContext } from '../../composables/useChatContext'
import { useFoldState } from '../../composables/useFoldState'
import { formatNumber } from '../../lib/tokens'
import { buildBlocks, type Block, type ToolCallView } from '../../lib/transcript/blocks'
import { useTranscriptStore } from '../../stores/transcript'
import { useUiStore } from '../../stores/ui'
import TranscriptBlock from './TranscriptBlock.vue'

/**
 * Subagente en el lugar de la llamada `Agent` que lo lanzó. Su transcript
 * se pide al desplegarlo por primera vez y se pinta anidado, sin virtualizar (son de decenas de
 * mensajes), con los mismos filtros y componentes que el principal.
 */
const props = defineProps<{
  call: ToolCallView & { subagent: NonNullable<ToolCallView['subagent']> }
  foldKey: string
  cwd?: string
  sessionId?: string
}>()

const PAGE = 200

const fold = useFoldState()
const ui = useUiStore()
const transcript = useTranscriptStore()
const open = computed(() => fold.isOpen(props.foldKey))
const agentId = computed(() => props.call.subagent.agentId)
const cacheKey = computed(() => `${props.sessionId ?? ''}/${agentId.value}`)

const chat = useChatContext()
/** Transcript en vivo del subagente mientras la sesión está activa. */
const liveItems = computed(() => chat.liveSubagents.value[props.call.id])
const running = computed(
  () => props.call.status === 'running' || chat.runningTools.value.has(props.call.id)
)

const diskInfo = computed(() =>
  transcript.payload?.subagents.find((s) => s.agentId === agentId.value)
)
const info = computed(() => {
  const live = liveItems.value
  if (!live) return diskInfo.value
  const messages = new Set(
    live.filter((i) => i.kind === 'assistant-text').map((i) => i.uuid ?? i.line)
  ).size
  return {
    messageCount: Math.max(messages, diskInfo.value?.messageCount ?? 0),
    toolCallCount: Math.max(
      live.filter((i) => i.kind === 'tool-use').length,
      diskInfo.value?.toolCallCount ?? 0
    )
  }
})
// Caché del store: la lista virtualizada desmonta y vuelve a montar la tarjeta, y desplegarla
// otra vez no debe repetir la petición.
const cache = transcript.subagentCache
const items = shallowRef<TranscriptItem[] | null | undefined>(cache.get(cacheKey.value))
const state = ref<'idle' | 'loading' | 'error'>('idle')
const error = ref<string | null>(null)
const limit = ref(PAGE)

async function load(): Promise<void> {
  if (!props.sessionId || state.value === 'loading') return
  state.value = 'loading'
  const key = cacheKey.value
  const result = await window.api.sessions.subagent(props.sessionId, agentId.value)
  if (key !== cacheKey.value) return
  if (!result.ok) {
    state.value = 'error'
    error.value = result.error.message
    return
  }
  state.value = 'idle'
  const loaded = result.data?.items ?? null
  cache.set(key, loaded)
  items.value = loaded
}

watch(
  [open, cacheKey, () => transcript.subagentTick],
  () => {
    items.value = cache.get(cacheKey.value)
    if (open.value && items.value === undefined && !liveItems.value) void load()
  },
  { immediate: true }
)

/** Claves con el subagente delante: no chocan con las del transcript principal en el plegado. */
const shown = computed(() => liveItems.value ?? items.value)
const blocks = computed<Block[]>(() => {
  if (!shown.value) return []
  return buildBlocks(shown.value, {
    filters: ui.viewer,
    ...(liveItems.value ? { live: { running: running.value } } : {})
  }).map((block) => ({
    ...block,
    key: `${agentId.value}/${block.key}`
  }))
})
const visible = computed(() => blocks.value.slice(0, limit.value))

const title = computed(() => props.call.subagent.agentType ?? 'Subagente')
const description = computed(() => props.call.subagent.description ?? '')
</script>

<template>
  <div class="flex flex-col rounded-menu border border-border">
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-menu px-3 py-2 text-left text-sm hover:bg-surface-hover"
      :aria-expanded="open"
      @click="fold.toggle(foldKey)"
    >
      <Bot class="shrink-0 text-muted" :size="16" :stroke-width="1.75" aria-hidden="true" />
      <span class="shrink-0 font-medium">{{ title }}</span>
      <span class="min-w-0 truncate text-muted" :title="description">{{ description }}</span>
      <span v-if="info" class="ml-auto shrink-0 text-xs text-muted">
        <template v-if="running">En curso · </template>
        {{ formatNumber(info.messageCount) }} mensajes ·
        {{ formatNumber(info.toolCallCount) }} herramientas
      </span>
      <ChevronRight
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
        class="shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none"
        :class="[open ? 'rotate-90' : '', info ? '' : 'ml-auto']"
      />
    </button>

    <div v-if="open" class="flex flex-col gap-4 border-t border-border py-3 pr-3 pl-4">
      <p v-if="state === 'loading' && !liveItems" class="text-sm text-muted">Cargando…</p>
      <div
        v-else-if="state === 'error' && !liveItems"
        class="flex items-center gap-3 text-sm"
        role="alert"
      >
        <span class="text-danger">No se pudo leer el subagente: {{ error }}</span>
        <button
          type="button"
          class="rounded-item border border-border px-2 py-0.5 hover:bg-surface-hover"
          @click="load"
        >
          Reintentar
        </button>
      </div>
      <p v-else-if="shown === null" class="text-sm text-muted">
        No se encontró el transcript del subagente.
      </p>
      <template v-else-if="shown">
        <p v-if="blocks.length === 0" class="text-sm text-muted">
          Nada que mostrar con los filtros actuales.
        </p>
        <TranscriptBlock
          v-for="block in visible"
          :key="block.key"
          :block="block"
          :cwd="cwd"
          :session-id="sessionId"
        />
        <button
          v-if="blocks.length > limit"
          type="button"
          class="w-fit rounded-item px-1 text-sm text-muted underline underline-offset-2 hover:text-text"
          @click="limit += PAGE"
        >
          Mostrar más ({{ formatNumber(blocks.length - limit) }} restantes)
        </button>
      </template>
    </div>
  </div>
</template>
