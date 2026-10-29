<script setup lang="ts">
import { t } from '../../i18n'
import {
  ListboxContent,
  ListboxFilter,
  ListboxItem,
  ListboxRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  type AcceptableValue
} from 'reka-ui'
import { Check, ChevronsUpDown, FolderPlus, FolderSearch, Pencil, X } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { ProjectView } from '../../../../shared/projects'
import { useShortcut } from '../../composables/useShortcut'
import { useProjectsStore } from '../../stores/projects'
import { useUiStore } from '../../stores/ui'
import ProjectIcon from './ProjectIcon.vue'

/**
 * Selector del proyecto activo: botón de la barra lateral que abre
 * un desplegable con búsqueda. Flechas, Enter y Esc los dan Listbox y Popover de Reka UI.
 */
const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ discover: []; remove: [project: ProjectView] }>()

const projects = useProjectsStore()
const ui = useUiStore()
const open = ref(false)
const query = ref('')

const IMPORT = '__import'
const DISCOVER = '__discover'

function matches(project: ProjectView, q: string): boolean {
  return (
    project.name.toLocaleLowerCase().includes(q) || project.path.toLocaleLowerCase().includes(q)
  )
}

/** «Mi PC» va aparte, arriba; luego los proyectos de carpeta. */
const filtered = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  const computer =
    projects.computer && (!q || matches(projects.computer, q)) ? projects.computer : null
  const folders = q ? projects.folders.filter((p) => matches(p, q)) : projects.folders
  return { computer, folders }
})
const groups = computed(() => [
  filtered.value.computer ? [filtered.value.computer] : [],
  filtered.value.folders
])

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    projects.clearError()
  }
})

/** Abre el desplegable; en el riel plegado, primero despliega la barra. */
async function show(): Promise<void> {
  if (ui.sidebarCollapsed) {
    ui.toggleSidebar()
    await nextTick()
  }
  open.value = true
}

function onTriggerClick(event: MouseEvent): void {
  if (!props.collapsed) return
  event.preventDefault()
  void show()
}

useShortcut('ctrl+p', () => {
  if (open.value) open.value = false
  else void show()
})

async function onPick(value: AcceptableValue | AcceptableValue[] | undefined): Promise<void> {
  if (typeof value !== 'string') {
    // Volver a elegir el proyecto activo lo «deselecciona»: solo se cierra.
    open.value = false
    return
  }
  if (value === IMPORT) {
    const imported = await projects.importFolder()
    // Si falla, el desplegable sigue abierto con el mensaje.
    if (imported || !projects.error) open.value = false
    return
  }
  if (value === DISCOVER) {
    open.value = false
    emit('discover')
    return
  }
  open.value = false
  await projects.select(value)
}

function requestEdit(project: ProjectView): void {
  open.value = false
  projects.startEditing(project)
}

function requestRemove(project: ProjectView): void {
  open.value = false
  emit('remove', project)
}

defineExpose({ show })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      :class="[
        'no-drag flex w-full items-center gap-2.5 rounded-item px-2 text-left transition-colors duration-150 hover:bg-surface-hover data-[state=open]:bg-surface-hover',
        collapsed ? 'h-8 justify-center' : 'min-h-8 py-1'
      ]"
      :aria-label="
        collapsed
          ? t('Proyecto: {name}', { name: projects.active?.name ?? t('ninguno') })
          : undefined
      "
      :title="collapsed ? (projects.active?.name ?? t('Elegir proyecto')) : undefined"
      @click="onTriggerClick"
    >
      <ProjectIcon :project="projects.active" :size="18" />
      <template v-if="!collapsed">
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ projects.active?.name ?? t('Elegir proyecto') }}</span>
          <span v-if="projects.active?.missing" class="block truncate text-xs text-muted">
            {{ t('Carpeta no encontrada') }}
          </span>
        </span>
        <ChevronsUpDown :size="16" :stroke-width="1.75" class="shrink-0 text-muted" />
      </template>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        class="z-30 w-[max(var(--reka-popover-trigger-width),16rem)] max-w-[calc(100vw-1rem)] rounded-menu bg-surface p-1 text-text shadow-float"
      >
        <ListboxRoot
          :model-value="projects.activeId ?? undefined"
          highlight-on-hover
          @update:model-value="onPick"
        >
          <ListboxFilter
            v-model="query"
            auto-focus
            :placeholder="t('Buscar proyecto…')"
            :aria-label="t('Buscar proyecto')"
            class="mb-1 h-8 w-full rounded-item bg-transparent px-2 text-text outline-none placeholder:text-muted"
          />
          <ListboxContent class="max-h-80 overflow-y-auto">
            <template v-for="(group, g) in groups" :key="g">
              <div
                v-if="g === 1 && filtered.computer && filtered.folders.length > 0"
                class="my-1 h-px bg-border"
                role="separator"
              />
              <ListboxItem
                v-for="project in group"
                :key="project.id"
                :value="project.id"
                class="group flex min-h-8 cursor-default items-center gap-2 rounded-item px-2 py-1 outline-none data-[highlighted]:bg-surface-hover"
              >
                <ProjectIcon :project="project" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ project.name }}</span>
                  <span class="block truncate text-xs text-muted" :title="project.path">
                    {{ project.missing ? `${t('Carpeta no encontrada')} · ` : ''
                    }}{{
                      project.kind === 'computer' ? t('Consultas sobre tu ordenador') : project.path
                    }}
                  </span>
                </span>
                <Check
                  v-if="project.id === projects.activeId"
                  :size="16"
                  :stroke-width="1.75"
                  class="shrink-0 text-accent"
                  :aria-label="t('Activo')"
                />
                <button
                  type="button"
                  :aria-label="t('Personalizar {name}', { name: project.name })"
                  :title="t('Personalizar…')"
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[highlighted]:opacity-100 hover:text-text focus-visible:opacity-100"
                  @pointerdown.stop
                  @click.stop="requestEdit(project)"
                  @keydown.enter.stop.prevent="requestEdit(project)"
                  @keydown.space.stop.prevent="requestEdit(project)"
                >
                  <Pencil :size="14" :stroke-width="1.75" />
                </button>
                <button
                  v-if="project.kind !== 'computer'"
                  type="button"
                  :aria-label="t('Quitar {name}', { name: project.name })"
                  :title="t('Quitar')"
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[highlighted]:opacity-100 hover:text-text focus-visible:opacity-100"
                  @pointerdown.stop
                  @click.stop="requestRemove(project)"
                  @keydown.enter.stop.prevent="requestRemove(project)"
                  @keydown.space.stop.prevent="requestRemove(project)"
                >
                  <X :size="14" :stroke-width="1.75" />
                </button>
              </ListboxItem>
            </template>
            <p
              v-if="
                projects.projects.length > 0 && !filtered.computer && filtered.folders.length === 0
              "
              class="px-2 py-2 text-muted"
            >
              {{ t('Ningún proyecto coincide.') }}
            </p>
            <div v-if="projects.projects.length > 0" class="my-1 h-px bg-border" role="separator" />
            <ListboxItem
              :value="IMPORT"
              class="flex h-8 cursor-default items-center gap-2 rounded-item px-2 outline-none data-[highlighted]:bg-surface-hover"
            >
              <FolderPlus :size="16" :stroke-width="1.75" class="shrink-0" />
              {{ t('Importar carpeta…') }}
            </ListboxItem>
            <ListboxItem
              :value="DISCOVER"
              class="flex h-8 cursor-default items-center gap-2 rounded-item px-2 outline-none data-[highlighted]:bg-surface-hover"
            >
              <FolderSearch :size="16" :stroke-width="1.75" class="shrink-0" />
              {{ t('Descubrir proyectos…') }}
            </ListboxItem>
          </ListboxContent>
        </ListboxRoot>
        <p v-if="projects.error" class="px-2 pt-1 pb-1.5 text-sm text-danger" role="alert">
          {{ projects.error }}
        </p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
