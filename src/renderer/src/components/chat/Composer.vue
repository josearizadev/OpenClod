<script setup lang="ts">
import { t } from '../../i18n'
import { ArrowUp, ChevronDown, Paperclip, Square } from 'lucide-vue-next'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, nextTick, onMounted, ref, toRaw, useTemplateRef, watch } from 'vue'
import type { ChatAttachment, ChatMode, ChatModel } from '../../../../shared/chat'
import type { MentionEntry, MentionTarget } from '../../../../shared/files'
import { attachFiles, attachPaths, type AttachResult } from '../../lib/attachments'
import type { SlashEntry } from '../../lib/slash-commands'
import AttachmentChip from './AttachmentChip.vue'
import ModePicker from './ModePicker.vue'
import ModelPicker from './ModelPicker.vue'
import MentionMenu from './MentionMenu.vue'
import SlashMenu from './SlashMenu.vue'

/**
 * Compositor del chat: textarea autoexpandible, selectores de modo y
 * modelo, enviar y detener. Mientras Claude trabaja sigue activo: `Enter` envía (el main
 * lo encola), `Ctrl+Enter` lo envía ya, `Shift+Enter` salto de línea y `Esc` detiene.
 * Adjuntos: clip, pegar y soltar; se envían con el mensaje. `@ruta` menciona un archivo
 * como en la terminal: va tal cual en el texto y Claude Code lo lee.
 */
const props = defineProps<{
  /** Claude está trabajando: aparece detener y enviar encola. */
  working?: boolean
  /** Compositor bloqueado entero (p. ej. sin carpeta de trabajo). */
  disabled?: boolean
  placeholder?: string
  models?: ChatModel[]
  /** Sin selectores (la sesión aún no ha arrancado). */
  hidePickers?: boolean
  /** Comandos para el autocompletado de `/` (pregunta abierta 6). */
  commands?: SlashEntry[]
  /** Sin adjuntos (p. ej. editando un mensaje de la cola, que no los cambia). */
  noAttach?: boolean
  /** Carpeta de las menciones `@`; sin ella no se sugieren archivos. */
  mentions?: MentionTarget | null
}>()

const emit = defineEmits<{
  send: [text: string, now: boolean, attachments: ChatAttachment[]]
  stop: []
}>()

const text = defineModel<string>({ default: '' })
const model = defineModel<string | null>('model', { default: null })
const mode = defineModel<ChatMode>('mode', { default: 'default' })
const attachments = defineModel<ChatAttachment[]>('attachments', { default: () => [] })
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

const canSend = computed(
  () => !props.disabled && (text.value.trim() !== '' || attachments.value.length > 0)
)

// --- Adjuntos ---------------------------------------------------------------------------
const attachError = ref<string | null>(null)
const dragging = ref(false)
const canAttach = computed(() => !props.disabled && !props.noAttach)

function add(result: AttachResult): void {
  if (result.attachments.length > 0)
    attachments.value = [...attachments.value, ...result.attachments]
  attachError.value = result.errors[0] ?? null
}

function remove(index: number): void {
  attachments.value = attachments.value.filter((_, i) => i !== index)
  attachError.value = null
  focus()
}

async function pickFiles(): Promise<void> {
  const result = await window.api.system.pickFiles()
  if (result.ok && result.data.length > 0) add(attachPaths(result.data, attachments.value))
  focus()
}

/** Pegar archivos o una captura; si el portapapeles trae texto, se pega el texto. */
async function onPaste(event: ClipboardEvent): Promise<void> {
  const data = event.clipboardData
  if (!canAttach.value || !data || data.files.length === 0) return
  if (data.getData('text/plain').trim() !== '') return
  event.preventDefault()
  add(await attachFiles([...data.files], attachments.value))
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function onDragOver(event: DragEvent): void {
  if (!canAttach.value || !hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false
  if (!canAttach.value || !hasFiles(event)) return
  event.preventDefault()
  add(await attachFiles([...(event.dataTransfer?.files ?? [])], attachments.value))
  focus()
}

// --- Autocompletado de comandos ---------------------------------------------------------
const MAX_SUGGESTIONS = 8
const dismissed = ref<string | null>(null)
const active = ref(0)
/** `/nombre` sin espacios al principio del texto: lo que se completa. */
const slashQuery = computed(() => /^\/([^\s/]*)$/.exec(text.value)?.[1] ?? null)
const suggestions = computed<SlashEntry[]>(() => {
  const query = slashQuery.value
  if (query === null || dismissed.value === text.value) return []
  const q = query.toLowerCase()
  return (props.commands ?? [])
    .filter((c) => c.name.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
})
watch(suggestions, () => (active.value = 0))

function pick(name: string): void {
  text.value = `/${name} `
  dismissed.value = null
  focus()
}

// --- Menciones de archivos con `@` -------------------------------------------------------
/** Posición del cursor: la mención que se completa es la que acaba justo ahí. */
const caret = ref(0)
function syncCaret(): void {
  caret.value = textarea.value?.selectionStart ?? text.value.length
}

/** `@consulta` (o `@"con espacios`) al principio o tras un espacio, pegada al cursor. */
const mention = computed<{ start: number; query: string } | null>(() => {
  if (!props.mentions) return null
  const before = text.value.slice(0, caret.value)
  const match = /(?:^|\s)@(?:"([^"]*)|([^\s"]*))$/.exec(before)
  if (!match) return null
  return { start: match.index + match[0].indexOf('@'), query: match[1] ?? match[2] ?? '' }
})
const mentionItems = ref<MentionEntry[]>([])
const mentionActive = ref(0)
const mentionDismissed = ref<string | null>(null)
const mentionEntries = computed(() =>
  mention.value && mentionDismissed.value !== text.value ? mentionItems.value : []
)
watch(mentionEntries, () => (mentionActive.value = 0))

let mentionTicket = 0
let mentionTimer: number | undefined
watch(
  () => mention.value?.query ?? null,
  (query) => {
    window.clearTimeout(mentionTimer)
    const ticket = ++mentionTicket
    const target = props.mentions
    if (query === null || !target) {
      mentionItems.value = []
      return
    }
    // Espera breve: no se pide una lista por cada tecla al escribir deprisa.
    mentionTimer = window.setTimeout(async () => {
      const result = await window.api.files.mentions({ target: toRaw(target), query })
      if (ticket === mentionTicket) mentionItems.value = result.ok ? result.data : []
    }, 80)
  }
)

/** Sustituye la mención por la ruta elegida: un archivo cierra con espacio, una carpeta sigue. */
function pickMention(entry: MentionEntry): void {
  const current = mention.value
  if (!current) return
  const quoted = /\s/.test(entry.path)
  const path = entry.dir ? `${entry.path}/` : entry.path
  const inserted = quoted
    ? entry.dir
      ? `@"${path}`
      : `@"${path}" `
    : entry.dir
      ? `@${path}`
      : `@${path} `
  const end = caret.value
  text.value = text.value.slice(0, current.start) + inserted + text.value.slice(end)
  const at = current.start + inserted.length
  caret.value = at
  mentionDismissed.value = null
  // Un `keyup` antes del repintado leería el cursor del texto viejo: se fija otra vez.
  void nextTick(() => {
    textarea.value?.setSelectionRange(at, at)
    caret.value = at
    focus()
  })
}

/** El menú abierto (comandos o archivos): mismas teclas para los dos. */
function onMenuKey(event: KeyboardEvent): boolean {
  const slash = suggestions.value.length > 0
  const count = slash ? suggestions.value.length : mentionEntries.value.length
  if (count === 0) return false
  const index = slash ? active : mentionActive
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    index.value = (index.value + step + count) % count
    return true
  }
  if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.isComposing)) {
    event.preventDefault()
    if (slash) {
      const choice = suggestions.value[active.value]
      if (choice) pick(choice.name)
    } else {
      const choice = mentionEntries.value[mentionActive.value]
      if (choice) pickMention(choice)
    }
    return true
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    if (slash) dismissed.value = text.value
    else mentionDismissed.value = text.value
    return true
  }
  return false
}

const menuId = computed(() =>
  suggestions.value.length > 0
    ? { list: 'slash-menu', option: `slash-${active.value}` }
    : mentionEntries.value.length > 0
      ? { list: 'mention-menu', option: `mention-${mentionActive.value}` }
      : null
)

function onKeydown(event: KeyboardEvent): void {
  if (onMenuKey(event)) {
    event.stopImmediatePropagation()
    return
  }
  if (event.key === 'Enter') onEnter(event)
  else if (event.key === 'Escape') onEscape(event)
}

function send(now = false): void {
  // Del propio textarea: el `v-model` del padre puede no haberse propagado aún.
  const value = (textarea.value?.value ?? text.value).trim()
  if (props.disabled || (value === '' && attachments.value.length === 0)) return
  emit('send', value, now, [...attachments.value])
  text.value = ''
  caret.value = 0
  attachments.value = []
  attachError.value = null
}

// Durante la composición de un IME, Enter confirma el carácter y no envía.
function onEnter(event: KeyboardEvent): void {
  if (event.shiftKey || event.isComposing) return
  event.preventDefault()
  send(event.ctrlKey || event.metaKey)
}

function onEscape(event: KeyboardEvent): void {
  if (!props.working) return
  event.preventDefault()
  emit('stop')
}

function focus(): void {
  textarea.value?.focus()
}

onMounted(focus)
defineExpose({ focus, textarea })
</script>

<template>
  <div class="flex w-full flex-col gap-2">
    <slot name="above" />
    <!-- Clic en cualquier zona vacía de la tarjeta lleva el foco al texto. -->
    <div
      class="flex w-full cursor-text flex-col gap-2 rounded-composer border border-dashed bg-surface p-3 shadow-float"
      :class="dragging ? 'border-accent' : 'border-transparent'"
      @click.self="focus"
      @dragover="onDragOver"
      @dragleave.self="dragging = false"
      @drop="onDrop"
    >
      <SlashMenu :commands="suggestions" :active="active" @pick="pick" @hover="active = $event" />
      <MentionMenu
        v-if="suggestions.length === 0"
        :entries="mentionEntries"
        :active="mentionActive"
        @pick="pickMention"
        @hover="mentionActive = $event"
      />
      <ul v-if="attachments.length > 0" class="flex flex-wrap gap-2" :aria-label="t('Adjuntos')">
        <AttachmentChip
          v-for="(attachment, index) in attachments"
          :key="attachment.kind === 'file' ? attachment.path : `${index}-${attachment.name}`"
          :attachment="attachment"
          @remove="remove(index)"
        />
      </ul>
      <p v-if="attachError" class="px-1 text-sm text-danger" role="alert">{{ attachError }}</p>
      <!-- `field-sizing: content` crece con el texto (1 → 12 líneas) sin medir en JS. -->
      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        :disabled="disabled"
        :placeholder="placeholder ?? t('Escribe un mensaje…')"
        :aria-label="t('Mensaje')"
        class="field-sizing-content max-h-[18rem] min-h-6 w-full resize-none bg-transparent px-1 text-base leading-6 outline-none placeholder:text-muted disabled:cursor-not-allowed"
        :aria-autocomplete="commands || mentions ? 'list' : undefined"
        :aria-controls="menuId?.list"
        :aria-activedescendant="menuId?.option"
        @keydown="onKeydown"
        @input="syncCaret"
        @keyup="syncCaret"
        @click="syncCaret"
        @paste="onPaste"
      />

      <div class="flex items-center gap-1" @click.self="focus">
        <button
          v-if="!noAttach"
          type="button"
          :disabled="disabled"
          :aria-label="t('Adjuntar archivos')"
          :title="t('Adjuntar archivos (o pégalos y suéltalos aquí)')"
          class="inline-flex size-8 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
          @click="pickFiles"
        >
          <Paperclip :size="16" :stroke-width="1.75" />
        </button>
        <ModePicker v-if="!hidePickers" v-model="mode" />
        <slot name="tools" />
        <div class="flex-1" @click="focus" />
        <ModelPicker v-if="!hidePickers" v-model="model" :models="models ?? []" />
        <button
          v-if="working"
          type="button"
          :aria-label="t('Detener')"
          :title="t('Detener (Esc)')"
          class="inline-flex size-8 items-center justify-center rounded-item border border-border text-text transition-colors duration-150 hover:bg-surface-hover"
          @click="emit('stop')"
        >
          <Square :size="12" fill="currentColor" :stroke-width="0" aria-hidden="true" />
        </button>
        <div class="flex items-center">
          <button
            type="button"
            :aria-label="working ? t('Poner en cola') : t('Enviar')"
            :title="
              working ? t('Poner en cola (Enter) · Enviar ya (Ctrl+Enter)') : t('Enviar (Enter)')
            "
            :disabled="!canSend"
            class="inline-flex size-8 items-center justify-center bg-accent text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
            :class="working ? 'rounded-l-item' : 'rounded-item'"
            @click="send(false)"
          >
            <ArrowUp :size="18" :stroke-width="2" aria-hidden="true" />
          </button>
          <!-- Mientras trabaja: menú con «Enviar ya». -->
          <DropdownMenuRoot v-if="working">
            <DropdownMenuTrigger
              :disabled="!canSend"
              :aria-label="t('Más opciones de envío')"
              class="inline-flex h-8 w-5 items-center justify-center rounded-r-item border-l border-on-accent/30 bg-accent text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
            >
              <ChevronDown :size="14" :stroke-width="2" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                align="end"
                side="top"
                :side-offset="6"
                class="z-30 w-64 rounded-menu bg-surface p-1 text-text shadow-float"
              >
                <DropdownMenuItem
                  class="flex min-h-8 cursor-default flex-col items-start gap-0.5 rounded-item px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-hover"
                  @select="send(true)"
                >
                  <span
                    >{{ t('Enviar ya') }}
                    <kbd class="ml-1 text-xs text-muted">Ctrl+Enter</kbd></span
                  >
                  <span class="text-xs text-muted">{{
                    t('Claude lo recibe en el turno en curso')
                  }}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="flex min-h-8 cursor-default flex-col items-start gap-0.5 rounded-item px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-hover"
                  @select="send(false)"
                >
                  <span
                    >{{ t('Poner en cola') }} <kbd class="ml-1 text-xs text-muted">Enter</kbd></span
                  >
                  <span class="text-xs text-muted">{{ t('Se envía al terminar el turno') }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </div>
    </div>
  </div>
</template>
