<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useTextHighlight } from '../../composables/useTextHighlight'
import { findAnchor, type Block, type BlockKind } from '../../lib/transcript/blocks'
import NewMessagesPill from './NewMessagesPill.vue'
import TranscriptBlock from './TranscriptBlock.vue'
import TranscriptNav from './TranscriptNav.vue'

/**
 * Transcript virtualizado: solo se montan los bloques visibles y un
 * margen, con alturas medidas. Abre al final, conserva la posición al cambiar los bloques
 * anclándola al primero visible y el virtualizador compensa lo que cambia de tamaño por
 * encima de la vista.
 */
const props = defineProps<{
  blocks: Block[]
  /** Cambia al abrir otra sesión: entonces se va al final en lugar de anclar. */
  listKey: string
  cwd?: string
  sessionId?: string
  /**
   * Cambia cuando crece lo que va tras los bloques (tarjetas de permiso, errores): si se
   * estaba al final, se sigue al final.
   */
  tail?: string | number
  /** Términos normalizados que se resaltan (búsqueda). */
  highlight?: readonly string[]
  /** Bloque con la coincidencia actual (`find-current`). */
  currentKey?: string | null
  /** Resaltar solo al principio de palabra (búsqueda global). */
  wordStart?: boolean
}>()

const emit = defineEmits<{ painted: []; scrolled: [value: boolean] }>()

const scroller = ref<HTMLElement | null>(null)

const ESTIMATES: Record<BlockKind, number> = {
  user: 84,
  assistant: 160,
  thinking: 36,
  tools: 40,
  command: 36,
  notice: 32,
  duration: 32,
  internal: 32,
  separator: 40
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.blocks.length,
    getScrollElement: () => scroller.value,
    estimateSize: (index: number) => ESTIMATES[props.blocks[index]?.kind ?? 'assistant'],
    getItemKey: (index: number) => props.blocks[index]?.key ?? index,
    overscan: 8,
    paddingStart: 24,
    paddingEnd: 80
  }))
)

const items = computed(() => virtualizer.value.getVirtualItems())

useTextHighlight(
  scroller,
  computed(() => props.highlight ?? []),
  toRef(() => props.currentKey ?? null),
  toRef(() => props.wordStart ?? false)
)

/** Bloque al que se acaba de saltar: fondo que se desvanece 1,5 s. */
const targetKey = ref<string | null>(null)
let targetTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Centra el bloque `key` y lo marca (salto a un mensaje). Como `openAtEnd`, se
 * repite hasta que las alturas se estabilizan (máx. 8 marcos). `false` si no está.
 */
async function revealBlock(key: string): Promise<boolean> {
  const token = ++openToken
  await nextTick()
  const index = props.blocks.findIndex((b) => b.key === key)
  if (index === -1) return false
  let lastTotal = -1
  for (let frame = 0; frame < 8 && token === openToken; frame++) {
    virtualizer.value.scrollToIndex(index, { align: 'center' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const total = virtualizer.value.getTotalSize()
    if (total === lastTotal) break
    lastTotal = total
  }
  if (token !== openToken) return true
  onScroll()
  targetKey.value = key
  if (targetTimer) clearTimeout(targetTimer)
  targetTimer = setTimeout(() => (targetKey.value = null), 1500)
  return true
}
onBeforeUnmount(() => {
  if (targetTimer) clearTimeout(targetTimer)
})
const totalSize = computed(() => virtualizer.value.getTotalSize())

function measure(el: unknown): void {
  if (el instanceof Element) virtualizer.value.measureElement(el)
}

// --- Posición -----------------------------------------------------------------------------

const atEnd = ref(true)
const atStart = ref(true)

/**
 * Bloque que se está leyendo, guardado en cada scroll: cuando cambian los bloques, el
 * virtualizador ya tiene los nuevos y no se puede calcular a partir de ellos.
 */
let anchor: { key: string; line: number; offset: number } | null = null

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  atEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 48
  const top = el.scrollTop <= 8
  if (top !== atStart.value) emit('scrolled', !top)
  atStart.value = top
  const visible = firstVisible()
  const block = visible ? props.blocks[visible.index] : undefined
  anchor = block && visible ? { key: block.key, line: block.line, offset: visible.offset } : null
}

/**
 * Primer bloque visible y cuánto de él queda por encima del borde. Sale de las medidas del
 * virtualizador, no de los elementos montados: en un salto grande el rango montado aún es el
 * anterior cuando llega el evento `scroll`.
 */
function firstVisible(): { index: number; offset: number } | null {
  const offset = scroller.value?.scrollTop ?? 0
  const item = virtualizer.value.getVirtualItemForOffset(offset + 1)
  return item ? { index: item.index, offset: offset - item.start } : null
}

function scrollToEnd(): void {
  if (props.blocks.length > 0) {
    virtualizer.value.scrollToIndex(props.blocks.length - 1, { align: 'end' })
  }
  // El pie (tarjetas, errores) va tras el último bloque.
  const el = scroller.value
  if (el && footerHeight.value > 0) el.scrollTop = el.scrollHeight
  hasNew.value = false
}

/** Llegó contenido mientras se leía más arriba: punto en «Ir al final». */
const hasNew = ref(false)
const footer = ref<HTMLElement | null>(null)
const footerHeight = ref(0)
let footerObserver: ResizeObserver | null = null
watch(footer, (el) => {
  footerObserver?.disconnect()
  if (!el) return
  footerObserver = new ResizeObserver(() => {
    const before = footerHeight.value
    footerHeight.value = el.offsetHeight
    if (footerHeight.value > before && atEnd.value) void nextTick(scrollToEnd)
  })
  footerObserver.observe(el)
})
onBeforeUnmount(() => footerObserver?.disconnect())

function scrollToStart(): void {
  virtualizer.value.scrollToOffset(0)
}

function scrollToBlock(index: number): void {
  virtualizer.value.scrollToIndex(index, { align: 'start' })
}

/**
 * Al abrir: al final. La primera pasada usa alturas estimadas; el virtualizador reconcilia
 * marco a marco mientras las medidas cambian, y aquí se repite hasta que el total se estabiliza
 * (máx. 8 marcos).
 */
let openToken = 0
async function openAtEnd(): Promise<void> {
  const token = ++openToken
  await nextTick()
  let lastTotal = -1
  for (let frame = 0; frame < 8 && token === openToken; frame++) {
    scrollToEnd()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const total = virtualizer.value.getTotalSize()
    if (total === lastTotal) break
    lastTotal = total
  }
  if (token !== openToken) return
  onScroll()
  emit('painted')
}

/**
 * Mensajes nuevos llegados leyendo más arriba: bloques `user`/`assistant` cuya
 * clave no estaba al dejar el final. Por clave, no por índice: un bloque que crece no cuenta.
 */
let baseline: Set<string> | null = null
const newCount = ref(0)

let painted = ''
watch(
  () => [props.listKey, props.blocks] as const,
  ([key, next], old) => {
    if (next.length === 0) return
    if (painted !== key) {
      painted = key
      anchor = null
      baseline = null
      newCount.value = 0
      void openAtEnd()
      return
    }
    if (!atEnd.value) {
      baseline ??= new Set((old?.[1] ?? []).map((b) => b.key))
      const seen = baseline
      newCount.value = next.filter(
        (b) => (b.kind === 'user' || b.kind === 'assistant') && !seen.has(b.key)
      ).length
    }
    // Mismo transcript con otros bloques (filtros, recarga): al final se sigue al final; si no,
    // se vuelve al bloque que se leía (o al anterior más cercano si ya no está).
    const wasAtEnd = atEnd.value
    const saved = anchor
    if (!wasAtEnd) hasNew.value = true
    void nextTick(() => {
      if (wasAtEnd || !saved) {
        scrollToEnd()
        return
      }
      const index = findAnchor(next, saved.key, saved.line)
      const start = virtualizer.value.getOffsetForIndex(index, 'start')?.[0] ?? 0
      const exact = next[index]?.key === saved.key
      virtualizer.value.scrollToOffset(start + (exact ? saved.offset : 0))
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => openToken++)

watch(
  () => props.tail,
  () => {
    if (atEnd.value) void nextTick(scrollToEnd)
    else hasNew.value = true
  }
)
watch(atEnd, (end) => {
  if (!end) return
  hasNew.value = false
  baseline = null
  newCount.value = 0
})

// --- Teclado -----------------------------------------------------------

const promptIndexes = computed(() =>
  props.blocks.flatMap((block, index) => (block.kind === 'user' ? [index] : []))
)

/** Salta al prompt anterior (`-1`) o siguiente (`1`) respecto del primer bloque visible. */
function jumpPrompt(direction: -1 | 1): void {
  const visible = firstVisible()
  const current = visible?.index ?? 0
  const list = promptIndexes.value
  const target =
    direction === 1
      ? list.find((i) => i > current)
      : [...list]
          .reverse()
          .find((i) => i < current || (i === current && (visible?.offset ?? 0) > 4))
  if (target !== undefined) scrollToBlock(target)
  else if (direction === 1) scrollToEnd()
  else scrollToStart()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.target !== scroller.value) return
  if (event.key === 'Home' && !event.altKey && !event.ctrlKey) {
    event.preventDefault()
    scrollToStart()
  } else if (event.key === 'End' && !event.altKey && !event.ctrlKey) {
    event.preventDefault()
    scrollToEnd()
  }
}

/** Va al bloque de herramientas que contiene la llamada `toolUseId`. */
function scrollToTool(toolUseId: string): boolean {
  const index = props.blocks.findIndex(
    (b) => b.kind === 'tools' && b.calls.some((c) => c.id === toolUseId)
  )
  if (index === -1) return false
  scrollToBlock(index)
  return true
}

defineExpose({
  revealBlock,
  jumpPrompt,
  scrollToTool,
  scrollToEnd,
  scrollToStart,
  focus: () => scroller.value?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div
      ref="scroller"
      class="h-full overflow-y-auto focus-visible:outline-offset-[-2px]"
      tabindex="0"
      role="feed"
      aria-label="Transcript"
      @scroll.passive="onScroll"
      @keydown="onKeydown"
    >
      <div class="relative mx-auto w-full max-w-chat px-6" :style="{ height: `${totalSize}px` }">
        <article
          v-for="item in items"
          :key="String(item.key)"
          :ref="measure"
          :data-index="item.index"
          :data-key="blocks[item.index]?.key"
          class="absolute top-0 right-6 left-6 pb-6"
          :class="{ 'is-target': blocks[item.index]?.key === targetKey }"
          :style="{ transform: `translateY(${item.start}px)` }"
        >
          <TranscriptBlock
            v-if="blocks[item.index]"
            :block="blocks[item.index] as Block"
            :cwd="cwd"
            :session-id="sessionId"
          />
        </article>
      </div>
      <!-- Tras los bloques: tarjetas de permiso y errores de la sesión activa. -->
      <div
        v-if="$slots['footer']"
        ref="footer"
        class="mx-auto -mt-16 flex w-full max-w-chat flex-col gap-4 px-6 pb-8"
      >
        <slot name="footer" />
      </div>
    </div>
    <NewMessagesPill v-if="newCount > 0" :count="newCount" @go="scrollToEnd" />
    <TranscriptNav
      :at-start="atStart"
      :at-end="atEnd"
      :has-prompts="promptIndexes.length > 0"
      :has-new="hasNew"
      @prompt="jumpPrompt"
      @start="scrollToStart"
      @end="scrollToEnd"
    />
  </div>
</template>
