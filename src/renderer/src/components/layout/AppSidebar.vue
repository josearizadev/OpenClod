<script setup lang="ts">
import {
  Activity,
  Download,
  FolderPlus,
  Gauge,
  FolderSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  SquarePen,
  SquareTerminal
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { ProjectView } from '../../../../shared/projects'
import { useProjectsStore } from '../../stores/projects'
import { useSearchStore } from '../../stores/search'
import { useUiStore } from '../../stores/ui'
import { useUpdateStore } from '../../stores/update'
import DiscoverProjectsDialog from '../projects/DiscoverProjectsDialog.vue'
import ProjectPicker from '../projects/ProjectPicker.vue'
import SessionList from '../sessions/SessionList.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import IconButton from '../ui/IconButton.vue'
import ThemeToggle from '../ui/ThemeToggle.vue'
import SidebarItem from './SidebarItem.vue'

const ui = useUiStore()
const search = useSearchStore()
const projects = useProjectsStore()
const update = useUpdateStore()
/** Versión descargada que espera a reiniciar. */
const readyVersion = computed(() =>
  update.status.state === 'ready' ? update.status.version : null
)

const discoverOpen = ref(false)
const removing = ref<ProjectView | null>(null)
const confirmOpen = ref(false)

function askRemove(project: ProjectView): void {
  removing.value = project
  confirmOpen.value = true
}

async function confirmRemove(): Promise<void> {
  if (removing.value) await projects.remove(removing.value.id)
  removing.value = null
}
</script>

<template>
  <!-- 288 px desplegada, riel de 56 px plegada. -->
  <aside
    :class="[
      'flex h-full shrink-0 flex-col overflow-hidden bg-bg-sidebar transition-[width] duration-200',
      ui.sidebarCollapsed ? 'w-14' : 'w-72'
    ]"
    aria-label="Barra lateral"
  >
    <!-- Cabecera: también sirve para arrastrar la ventana. -->
    <div
      :class="[
        'drag-region flex h-12 shrink-0 items-center gap-2 px-3',
        ui.sidebarCollapsed ? 'justify-center' : ''
      ]"
    >
      <IconButton
        :icon="ui.sidebarCollapsed ? PanelLeftOpen : PanelLeftClose"
        :label="ui.sidebarCollapsed ? 'Desplegar barra lateral' : 'Plegar barra lateral'"
        :aria-expanded="!ui.sidebarCollapsed"
        @click="ui.toggleSidebar()"
      />
      <span v-if="!ui.sidebarCollapsed" class="truncate font-serif text-lg">OpenClod</span>
    </div>

    <nav class="flex shrink-0 flex-col gap-0.5 px-3 pb-2" aria-label="Acciones">
      <SidebarItem label="Nueva sesión" :icon="SquarePen" to="/" :collapsed="ui.sidebarCollapsed" />
      <SidebarItem
        label="Buscar"
        :icon="Search"
        :collapsed="ui.sidebarCollapsed"
        title="Buscar (Ctrl+K)"
        @click="search.open = true"
      />
      <SidebarItem
        label="Uso"
        :icon="Gauge"
        to="/uso"
        :collapsed="ui.sidebarCollapsed"
        title="Uso (Ctrl+U)"
      />
      <SidebarItem
        label="Terminal"
        :icon="SquareTerminal"
        to="/terminal"
        :collapsed="ui.sidebarCollapsed"
        title="Terminal (Ctrl+`)"
      />
    </nav>

    <!-- Proyecto activo. En el riel solo se ve su icono, que despliega la barra. -->
    <div class="shrink-0 px-3 pb-1">
      <ProjectPicker
        :collapsed="ui.sidebarCollapsed"
        @discover="discoverOpen = true"
        @remove="askRemove"
      />
    </div>

    <div v-if="!ui.sidebarCollapsed" class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <!-- Sin proyectos. -->
      <section
        v-if="projects.loaded && projects.projects.length === 0"
        class="mt-4 flex flex-col gap-1"
        aria-label="Sin proyectos"
      >
        <p class="mb-1 px-2 text-muted">
          Importa una carpeta de proyecto o elige entre las que ya usaste con Claude Code.
        </p>
        <button
          type="button"
          class="flex h-8 items-center gap-2 rounded-item px-2 transition-colors duration-150 hover:bg-surface-hover"
          @click="projects.importFolder()"
        >
          <FolderPlus :size="16" :stroke-width="1.75" /> Importar carpeta
        </button>
        <button
          type="button"
          class="flex h-8 items-center gap-2 rounded-item px-2 transition-colors duration-150 hover:bg-surface-hover"
          @click="discoverOpen = true"
        >
          <FolderSearch :size="16" :stroke-width="1.75" /> Descubrir proyectos
        </button>
        <p v-if="projects.error" class="px-2 text-sm text-danger" role="alert">
          {{ projects.error }}
        </p>
      </section>

      <SessionList v-else-if="projects.activeId" />
    </div>
    <div v-else class="flex-1" />

    <!-- Pie: usuario, diagnóstico y tema. -->
    <footer
      :class="[
        'flex shrink-0 gap-2 px-3 py-3',
        ui.sidebarCollapsed ? 'flex-col items-center' : 'items-center'
      ]"
    >
      <div v-if="!ui.sidebarCollapsed" class="flex min-w-0 flex-1 items-center gap-2">
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-full bg-text text-xs font-medium text-bg"
          aria-hidden="true"
          >U</span
        >
        <span class="truncate">Usuario local</span>
      </div>
      <button
        v-if="readyVersion"
        type="button"
        :title="`Reiniciar para actualizar a la ${readyVersion}`"
        :aria-label="`Reiniciar para actualizar a la ${readyVersion}`"
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-item bg-accent text-on-accent transition-colors duration-150 hover:bg-accent-hover"
        @click="update.install()"
      >
        <Download :size="18" :stroke-width="1.75" />
      </button>
      <SidebarItem
        v-if="ui.sidebarCollapsed"
        label="Diagnóstico"
        :icon="Activity"
        to="/diagnostico"
        collapsed
      />
      <RouterLink
        v-else
        to="/diagnostico"
        title="Diagnóstico"
        aria-label="Diagnóstico"
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text aria-[current=page]:bg-surface-hover aria-[current=page]:text-text"
      >
        <Activity :size="18" :stroke-width="1.75" />
      </RouterLink>
      <SidebarItem
        v-if="ui.sidebarCollapsed"
        label="Ajustes"
        :icon="Settings"
        to="/ajustes"
        collapsed
      />
      <RouterLink
        v-else
        to="/ajustes"
        title="Ajustes (Ctrl+,)"
        aria-label="Ajustes"
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text aria-[current=page]:bg-surface-hover aria-[current=page]:text-text"
      >
        <Settings :size="18" :stroke-width="1.75" />
      </RouterLink>
      <ThemeToggle :vertical="ui.sidebarCollapsed" />
    </footer>

    <DiscoverProjectsDialog v-model:open="discoverOpen" />
    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="`¿Quitar «${removing?.name ?? ''}» de OpenClod?`"
      description="No se borra nada de la carpeta ni de las sesiones de Claude Code."
      confirm-label="Quitar"
      @confirm="confirmRemove"
    />
  </aside>
</template>
