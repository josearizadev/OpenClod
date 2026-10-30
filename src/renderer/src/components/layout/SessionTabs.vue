<script setup lang="ts">
import { t } from '../../i18n'
import { CircleCheck, Ghost, Loader2, Plus, X } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import type { ProjectView } from '../../../../shared/projects'
import { useProjectsStore } from '../../stores/projects'
import { useTabsStore, type SessionTab } from '../../stores/tabs'
import ProjectIcon from '../projects/ProjectIcon.vue'

/**
 * Barra de pestañas de sesiones: icono del proyecto, título y estado (trabajando, esperando
 * permiso o terminado sin ver). Clic central o ✕ cierra; `+` abre una sesión nueva. Las de
 * incógnito llevan el fantasma. Se reordenan arrastrándolas (arrastrar no activa la pestaña).
 */
const tabs = useTabsStore()
const projects = useProjectsStore()
const strip = ref<HTMLElement | null>(null)

function projectOf(tab: SessionTab): ProjectView | null {
  return tab.projectId ? (projects.projects.find((p) => p.id === tab.projectId) ?? null) : null
}

function label(tab: SessionTab): string {
  if (!tab.sessionId) return t('Nueva sesión')
  return tabs.isIncognito(tab) ? t('Incógnito') : tab.title
}

function statusLabel(tab: SessionTab): string | null {
  switch (tabs.statusOf(tab)) {
    case 'working':
      return t('Trabajando')
    case 'waiting':
      return t('Esperando permiso')
    case 'done':
      return t('Terminó mientras no mirabas')
    default:
      return null
  }
}

function onAuxClick(event: MouseEvent, tab: SessionTab): void {
  if (event.button !== 1) return
  event.preventDefault()
  tabs.close(tab)
}

// La pestaña activa siempre a la vista.
watch(
  () => tabs.activeKey,
  async (key) => {
    await nextTick()
    strip.value
      ?.querySelector<HTMLElement>(`[data-tab="${key}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
)

// --- Arrastrar para reordenar ---------------------------------------------------

const DRAG_TYPE = 'application/x-openclod-tab'
const dragging = ref<string | null>(null)
/** Dónde caería: índice de la pestaña sobre la que se está y lado. */
const dropAt = ref<{ index: number; after: boolean } | null>(null)

function onDragStart(event: DragEvent, tab: SessionTab): void {
  if (!event.dataTransfer) return
  dragging.value = tab.key
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(DRAG_TYPE, tab.key)
}

function onDragOver(event: DragEvent, index: number): void {
  if (!dragging.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropAt.value = { index, after: event.clientX > box.left + box.width / 2 }
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const key = dragging.value
  const target = dropAt.value
  endDrag()
  if (!key || !target) return
  const from = tabs.tabs.findIndex((t) => t.key === key)
  if (from === -1) return
  let to = target.index + (target.after ? 1 : 0)
  // `move` cuenta sin la pestaña arrastrada.
  if (from < to) to -= 1
  tabs.move(key, to)
}

function endDrag(): void {
  dragging.value = null
  dropAt.value = null
}

function indicator(index: number): 'before' | 'after' | null {
  const at = dropAt.value
  if (!at || at.index !== index) return null
  return at.after ? 'after' : 'before'
}

/** Rueda vertical → desplazamiento horizontal de la tira. */
function onWheel(event: WheelEvent): void {
  if (!strip.value || event.deltaY === 0 || event.shiftKey) return
  strip.value.scrollLeft += event.deltaY
}
</script>

<template>
  <div class="flex h-9 shrink-0 items-end gap-1 border-b border-border px-2">
    <div
      ref="strip"
      role="tablist"
      :aria-label="t('Sesiones abiertas')"
      class="tab-strip flex min-w-0 items-end gap-0.5 overflow-x-auto"
      @wheel.passive="onWheel"
    >
      <div
        v-for="(tab, index) in tabs.tabs"
        :key="tab.key"
        :data-tab="tab.key"
        draggable="true"
        class="group relative flex h-8 w-[13.75rem] min-w-[7.5rem] shrink items-center gap-1.5 rounded-t-item pr-1 pl-2.5 text-sm transition-colors duration-150"
        :class="[
          tab.key === tabs.activeKey
            ? 'bg-surface text-text shadow-float'
            : 'text-muted hover:bg-surface-hover hover:text-text',
          dragging === tab.key ? 'opacity-50' : ''
        ]"
        @auxclick="onAuxClick($event, tab)"
        @mousedown.middle.prevent
        @dragstart="onDragStart($event, tab)"
        @dragover="onDragOver($event, index)"
        @drop="onDrop"
        @dragend="endDrag"
      >
        <span
          v-if="indicator(index)"
          class="pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-accent"
          :class="indicator(index) === 'before' ? '-left-0.5' : '-right-0.5'"
          aria-hidden="true"
        />
        <button
          type="button"
          role="tab"
          :aria-selected="tab.key === tabs.activeKey"
          :title="label(tab)"
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline"
          @click="tabs.select(tab)"
        >
          <Ghost
            v-if="tabs.isIncognito(tab)"
            :size="14"
            :stroke-width="1.75"
            class="shrink-0"
            aria-hidden="true"
          />
          <ProjectIcon v-else :project="projectOf(tab)" :size="14" />
          <span class="truncate">{{ label(tab) }}</span>
        </button>
        <span
          v-if="statusLabel(tab)"
          class="inline-flex size-4 shrink-0 items-center justify-center"
          role="img"
          :title="statusLabel(tab) ?? undefined"
          :aria-label="statusLabel(tab) ?? undefined"
        >
          <Loader2
            v-if="tabs.statusOf(tab) === 'working'"
            :size="14"
            :stroke-width="2"
            class="text-accent motion-safe:animate-spin"
          />
          <span
            v-else-if="tabs.statusOf(tab) === 'waiting'"
            class="size-2 rounded-full bg-warning"
          />
          <CircleCheck v-else :size="14" :stroke-width="2" class="text-accent" />
        </span>
        <button
          type="button"
          :aria-label="t('Cerrar pestaña «{title}»', { title: label(tab) })"
          :title="t('Cerrar (Ctrl+W)')"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted transition-opacity duration-150 hover:bg-surface-hover hover:text-text focus-visible:opacity-100"
          :class="tab.key === tabs.activeKey ? '' : 'opacity-0 group-hover:opacity-100'"
          @click="tabs.close(tab)"
        >
          <X :size="13" :stroke-width="2" />
        </button>
      </div>
    </div>
    <button
      type="button"
      :aria-label="t('Nueva sesión')"
      :title="t('Nueva sesión (Ctrl+N)')"
      class="mb-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      @click="tabs.openNew()"
    >
      <Plus :size="16" :stroke-width="1.75" />
    </button>
  </div>
</template>

<style scoped>
.tab-strip {
  scrollbar-width: none;
}
</style>
