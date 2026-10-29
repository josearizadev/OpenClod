<script setup lang="ts">
import { t } from '../../i18n'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from 'reka-ui'
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileCode,
  FileDown,
  FolderInput,
  PanelTop,
  Pencil,
  SquareTerminal,
  SquareCheck,
  Star,
  StarOff,
  Trash2,
  X
} from 'lucide-vue-next'
import { computed } from 'vue'
import { useSessionsStore } from '../../stores/sessions'
import { useTabsStore } from '../../stores/tabs'
import { useTerminalStore } from '../../stores/terminal'
import { useUiStore } from '../../stores/ui'

/**
 * Acciones de una sesión: Renombrar… · Favorita · Archivar/Desarchivar ·
 * Copiar id · Eliminar…. Lo usan el botón ⋯ y el menú contextual de la fila, y el ⋯ de
 * la cabecera; `kind` elige los primitivos de Reka del menú que lo contiene. `inList` añade
 * «Seleccionar». En la lista, si la sesión es parte de una selección de varias, el menú actúa
 * sobre toda la selección y solo ofrece lo que vale para varias.
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

/** Sesiones a las que afecta el menú: la selección entera o solo la pulsada. */
const targets = computed(() =>
  props.inList && sessions.selected.length > 1 && sessions.isSelected(props.sessionId)
    ? [...sessions.selected]
    : [props.sessionId]
)
const many = computed(() => targets.value.length > 1)
const itemsOf = computed(() =>
  targets.value.map((id) => sessions.items.find((i) => i.sessionId === id))
)
/** Con varias: favorita/archivar quitan si todas lo están; si no, ponen. */
const allFavorite = computed(() =>
  many.value ? itemsOf.value.every((i) => i?.favorite) : props.favorite
)
const allHidden = computed(() =>
  many.value ? itemsOf.value.every((i) => i?.hidden) : props.hidden
)

const Label = computed(() => (props.kind === 'context' ? ContextMenuLabel : DropdownMenuLabel))
const Item = computed(() => (props.kind === 'context' ? ContextMenuItem : DropdownMenuItem))
const Separator = computed(() =>
  props.kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
)

async function setFavorite(favorite: boolean): Promise<void> {
  if (many.value) await sessions.setFavoriteMany(targets.value, favorite)
  else await sessions.update(props.sessionId, { favorite })
  emit('changed')
}

async function setHidden(hidden: boolean): Promise<void> {
  if (many.value) await sessions.setHiddenMany(targets.value, hidden)
  else await sessions.update(props.sessionId, { hidden })
  emit('changed')
}

const tabs = useTabsStore()

/** Igual que eliminar: el diálogo se abre con el menú ya cerrado. */
function askMove(): void {
  const ids = targets.value
  setTimeout(() => sessions.askMove(ids), 0)
}

function unselectAll(): void {
  sessions.clearSelection()
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
  const ids = targets.value
  setTimeout(() => sessions.askTrash(ids), 0)
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
  <template v-if="many">
    <component :is="Label" class="px-2 pt-1 pb-1.5 text-xs font-medium text-muted">
      {{ t('{n} seleccionadas', { n: targets.length }) }}
    </component>
    <component :is="Item" :class="itemClass" @select="setFavorite(!allFavorite)">
      <component
        :is="allFavorite ? StarOff : Star"
        :size="16"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      {{ allFavorite ? t('Quitar de favoritas') : t('Marcar como favoritas') }}
    </component>
    <component :is="Item" :class="itemClass" @select="setHidden(!allHidden)">
      <component
        :is="allHidden ? ArchiveRestore : Archive"
        :size="16"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      {{ allHidden ? t('Desarchivar') : t('Archivar') }}
    </component>
    <component :is="Item" :class="itemClass" @select="askMove">
      <FolderInput :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Mover a proyecto…') }}
    </component>
    <component :is="Item" :class="itemClass" @select="unselectAll">
      <X :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Quitar la selección') }}
      <span class="ml-auto pl-4 text-xs text-muted">Esc</span>
    </component>
    <component :is="Separator" class="my-1 h-px bg-border" />
    <component :is="Item" :class="[itemClass, 'text-danger']" @select="askTrash">
      <Trash2 :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Eliminar…') }}
      <span class="ml-auto pl-4 text-xs text-muted">Supr</span>
    </component>
  </template>
  <template v-else>
    <component :is="Item" :class="itemClass" @select="rename">
      <Pencil :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Renombrar…') }}
      <span class="ml-auto pl-4 text-xs text-muted">F2</span>
    </component>
    <component :is="Item" :class="itemClass" @select="setFavorite(!favorite)">
      <component
        :is="favorite ? StarOff : Star"
        :size="16"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      {{ favorite ? t('Quitar de favoritas') : t('Marcar como favorita') }}
    </component>
    <component :is="Item" :class="itemClass" @select="setHidden(!hidden)">
      <component
        :is="hidden ? ArchiveRestore : Archive"
        :size="16"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      {{ hidden ? t('Desarchivar') : t('Archivar') }}
    </component>
    <component
      :is="Item"
      v-if="inList"
      :class="itemClass"
      @select="sessions.toggleSelect(sessionId)"
    >
      <SquareCheck :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ sessions.isSelected(sessionId) ? t('Quitar de la selección') : t('Seleccionar') }}
      <span class="ml-auto pl-4 text-xs text-muted">{{ t('Ctrl+clic') }}</span>
    </component>
    <component :is="Separator" class="my-1 h-px bg-border" />
    <component :is="Item" v-if="inList" :class="itemClass" @select="tabs.openInNewTab(sessionId)">
      <PanelTop :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Abrir en pestaña nueva') }}
      <span class="ml-auto pl-4 text-xs text-muted">{{ t('Clic central') }}</span>
    </component>
    <component :is="Item" :class="itemClass" @select="askMove">
      <FolderInput :size="16" :stroke-width="1.75" aria-hidden="true" />
      {{ t('Mover a proyecto…') }}
    </component>
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
</template>
