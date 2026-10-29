<script setup lang="ts">
import { t } from '../../i18n'
import { Archive, ArchiveRestore, CheckCheck, Trash2, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { useSessionsStore } from '../../stores/sessions'

/**
 * Barra de la selección múltiple: cuántas hay y qué hacer con ellas. `order`
 * son las entradas visibles, para «Seleccionar todo».
 */
const props = defineProps<{ order: readonly string[] }>()

const sessions = useSessionsStore()
const count = computed(() => sessions.selected.length)
/** Todas archivadas: el botón desarchiva; si no, archiva. */
const allHidden = computed(() =>
  sessions.selected.every((id) => sessions.items.find((i) => i.sessionId === id)?.hidden)
)
const allSelected = computed(() => props.order.every((id) => sessions.isSelected(id)))

const button =
  'no-drag inline-flex size-7 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40'
</script>

<template>
  <div
    class="sticky top-0 z-10 mt-2 flex items-center gap-0.5 rounded-item bg-surface py-1 pr-1 pl-2 shadow-float"
    role="toolbar"
    :aria-label="t('Sesiones seleccionadas')"
  >
    <span class="mr-auto text-xs font-medium" aria-live="polite">
      {{ count === 1 ? t('1 seleccionada') : t('{n} seleccionadas', { n: count }) }}
    </span>
    <button
      type="button"
      :class="button"
      :disabled="allSelected"
      :aria-label="t('Seleccionar todo')"
      :title="t('Seleccionar todo')"
      @click="sessions.selectAll(order)"
    >
      <CheckCheck :size="16" :stroke-width="1.75" />
    </button>
    <button
      type="button"
      :class="button"
      :aria-label="allHidden ? t('Desarchivar') : t('Archivar')"
      :title="allHidden ? t('Desarchivar') : t('Archivar')"
      @click="sessions.setHiddenMany(sessions.selected, !allHidden)"
    >
      <component :is="allHidden ? ArchiveRestore : Archive" :size="16" :stroke-width="1.75" />
    </button>
    <button
      type="button"
      :class="[button, 'hover:text-danger']"
      :aria-label="t('Eliminar…')"
      :title="t('Eliminar… (Supr)')"
      @click="sessions.askTrash(sessions.selected)"
    >
      <Trash2 :size="16" :stroke-width="1.75" />
    </button>
    <button
      type="button"
      :class="button"
      :aria-label="t('Quitar la selección')"
      :title="t('Quitar la selección (Esc)')"
      @click="sessions.clearSelection()"
    >
      <X :size="16" :stroke-width="1.75" />
    </button>
  </div>
</template>
