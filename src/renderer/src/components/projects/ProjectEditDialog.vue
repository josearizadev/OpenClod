<script setup lang="ts">
import { t } from '../../i18n'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import type { ProjectColor, ProjectIcon as ProjectIconId } from '../../../../shared/types'
import { projectIcon } from '../../lib/project-look'
import LookPicker from '../ui/LookPicker.vue'
import { useProjectsStore } from '../../stores/projects'
import ProjectIcon from './ProjectIcon.vue'

/**
 * Personalizar un proyecto: nombre visible, icono y color. Se guarda en `state.json`; el nombre
 * vacío vuelve al de la carpeta (o «Mi PC»). Hay uno solo en la app (`AppSidebar`).
 */
const projects = useProjectsStore()

const open = computed({
  get: () => projects.editing !== null,
  set: (value) => {
    if (!value) projects.editing = null
  }
})
const name = ref('')
const icon = ref<ProjectIconId | null>(null)
const color = ref<ProjectColor | null>(null)
const saving = ref(false)
const input = ref<HTMLInputElement | null>(null)

const target = computed(() => projects.editing)
/** Nombre que se usará si se deja vacío. */
const placeholder = computed(() => {
  const project = target.value
  if (!project) return ''
  if (project.kind === 'computer') return t('Mi PC')
  return project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path
})
const preview = computed(() => ({
  kind: target.value?.kind,
  icon: icon.value ?? undefined,
  color: color.value ?? undefined
}))

watch(target, (project) => {
  if (!project) return
  name.value = project.name
  icon.value = project.icon ?? null
  color.value = project.color ?? null
})

async function save(): Promise<void> {
  const project = target.value
  if (!project || saving.value) return
  saving.value = true
  const ok = await projects.customize({
    id: project.id,
    name: name.value.trim() || null,
    icon: icon.value,
    color: color.value
  })
  saving.value = false
  if (ok) projects.editing = null
}

/** Lo que se ve en «Predeterminado»: carpeta, o monitor para Mi PC. */
const defaultIcon = computed(() => projectIcon({ kind: target.value?.kind }))
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-dialog bg-surface p-5 text-text shadow-float"
        @open-auto-focus.prevent="input?.select()"
      >
        <DialogTitle class="font-serif text-lg">{{ t('Personalizar proyecto') }}</DialogTitle>
        <DialogDescription class="mt-1 truncate text-sm text-muted" :title="target?.path">
          {{ target?.path }}
        </DialogDescription>
        <form class="mt-4 flex flex-col gap-4" @submit.prevent="save">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">{{ t('Nombre') }}</span>
            <span class="flex items-center gap-2">
              <span
                class="inline-flex size-9 shrink-0 items-center justify-center rounded-item bg-surface-hover"
              >
                <ProjectIcon :project="preview" :size="18" />
              </span>
              <input
                ref="input"
                v-model="name"
                type="text"
                maxlength="256"
                :placeholder="placeholder"
                class="h-9 w-full rounded-item border border-border bg-bg px-3 text-text outline-none placeholder:text-muted focus-visible:border-accent"
              />
            </span>
          </label>

          <LookPicker
            v-model:icon="icon"
            v-model:color="color"
            :default-icon="defaultIcon"
            :no-icon-label="t('Predeterminado')"
            :exclude="['folder']"
          />

          <p v-if="projects.error" class="text-sm text-danger" role="alert">{{ projects.error }}</p>

          <div class="flex justify-end gap-2">
            <DialogClose
              type="button"
              class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
            >
              {{ t('Cancelar') }}
            </DialogClose>
            <button
              type="submit"
              :disabled="saving"
              class="h-8 rounded-item bg-accent px-3 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60"
            >
              {{ t('Guardar') }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
