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
 * incógnito llevan el fantasma.
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
        v-for="tab in tabs.tabs"
        :key="tab.key"
        :data-tab="tab.key"
        class="group relative flex h-8 w-[13.75rem] min-w-[7.5rem] shrink items-center gap-1.5 rounded-t-item pr-1 pl-2.5 text-sm transition-colors duration-150"
        :class="
          tab.key === tabs.activeKey
            ? 'bg-surface text-text shadow-float'
            : 'text-muted hover:bg-surface-hover hover:text-text'
        "
        @auxclick="onAuxClick($event, tab)"
        @mousedown.middle.prevent
      >
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
