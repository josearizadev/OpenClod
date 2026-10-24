<script setup lang="ts">
import { t } from '../../i18n'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSeparator
} from 'reka-ui'
import {
  Copy,
  Eye,
  EyeOff,
  FileCode,
  FileDown,
  Pencil,
  SquareTerminal,
  SquareCheck,
  Star,
  StarOff,
  Trash2
} from 'lucide-vue-next'
import { computed } from 'vue'
import { useSessionsStore } from '../../stores/sessions'
import { useTerminalStore } from '../../stores/terminal'
import { useUiStore } from '../../stores/ui'

/**
 * Acciones de una sesión: Renombrar… · Favorita · Ocultar/Mostrar ·
 * Copiar id · Eliminar…. Lo usan el botón ⋯ y el menú contextual de la fila, y el ⋯ de
 * la cabecera; `kind` elige los primitivos de Reka del menú que lo contiene. `inList` añade
 * «Seleccionar».
 */
const props = defineProps<{
  kind: 'dropdown' | 'context'
  inList?: boolean
  sessionId: string
  title: string
  favorite: boolean
  hidden: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

const sessions = useSessionsStore()
const Item = computed(() => (props.kind === 'context' ? ContextMenuItem : DropdownMenuItem))
const Separator = computed(() =>
  props.kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
)

async function set(patch: { favorite?: boolean; hidden?: boolean }): Promise<void> {
  await sessions.update(props.sessionId, patch)
  emit('changed')
}

/**
 * El diálogo se abre cuando el menú ya se ha cerrado: si no, la devolución del foco al disparador
 * del menú cuenta como «foco fuera» y lo cierra al instante.
 */
function rename(): void {
  setTimeout(() => sessions.startRename(props.sessionId, props.title), 0)
}

/** Continuar la sesión con `claude --resume` en la terminal. */
const terminal = useTerminalStore()
function openInTerminal(): void {
  // Después de cerrar el menú: si hay que confirmar, el diálogo no debe perder el foco.
  setTimeout(() => void terminal.resume(props.sessionId), 0)
}

/** Exportar a Markdown: diálogo nativo en el main y aviso al terminar. */
const ui = useUiStore()
async function exportMarkdown(tools: boolean): Promise<void> {
  const result = await window.api.sessions.export({ sessionId: props.sessionId, tools })
  if (!result.ok)
    return ui.toast(t('No se pudo exportar: {error}', { error: result.error.message }), {
      tone: 'danger'
    })
  const saved = result.data
  if (!saved) return
  ui.toast(t('Sesión exportada'), {
    action: {
      label: t('Mostrar en la carpeta'),
      run: () => void window.api.files.revealExport(saved.path)
    }
  })
}

/** Igual que renombrar: el diálogo se abre con el menú ya cerrado. */
function askTrash(): void {
  setTimeout(() => sessions.askTrash([props.sessionId]), 0)
}

async function copyId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.sessionId)
  } catch (error) {
    console.error('No se pudo copiar el id de la sesión:', error)
  }
}

const itemClass =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <component :is="Item" :class="itemClass" @select="rename">
    <Pencil :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Renombrar…') }}
    <span class="ml-auto pl-4 text-xs text-muted">F2</span>
  </component>
  <component :is="Item" :class="itemClass" @select="set({ favorite: !favorite })">
    <component :is="favorite ? StarOff : Star" :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ favorite ? t('Quitar de favoritas') : t('Marcar como favorita') }}
  </component>
  <component :is="Item" :class="itemClass" @select="set({ hidden: !hidden })">
    <component :is="hidden ? Eye : EyeOff" :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ hidden ? t('Mostrar en la lista') : t('Ocultar') }}
  </component>
  <component :is="Item" v-if="inList" :class="itemClass" @select="sessions.toggleSelect(sessionId)">
    <SquareCheck :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ sessions.isSelected(sessionId) ? t('Quitar de la selección') : t('Seleccionar') }}
    <span class="ml-auto pl-4 text-xs text-muted">{{ t('Ctrl+clic') }}</span>
  </component>
  <component :is="Separator" class="my-1 h-px bg-border" />
  <component :is="Item" :class="itemClass" @select="openInTerminal">
    <SquareTerminal :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Abrir en terminal') }}
  </component>
  <component :is="Item" :class="itemClass" @select="exportMarkdown(false)">
    <FileDown :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Exportar a Markdown…') }}
  </component>
  <component :is="Item" :class="itemClass" @select="exportMarkdown(true)">
    <FileCode :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Exportar con herramientas…') }}
  </component>
  <component :is="Item" :class="itemClass" @select="copyId">
    <Copy :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Copiar id de sesión') }}
  </component>
  <component :is="Separator" class="my-1 h-px bg-border" />
  <component :is="Item" :class="[itemClass, 'text-danger']" @select="askTrash">
    <Trash2 :size="16" :stroke-width="1.75" aria-hidden="true" />
    {{ t('Eliminar…') }}
  </component>
</template>
