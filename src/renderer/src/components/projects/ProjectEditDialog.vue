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
import { Ban, Check } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColor,
  type ProjectIcon as ProjectIconId
} from '../../../../shared/types'
import {
  PROJECT_COLOR_CLASSES,
  PROJECT_ICON_COMPONENTS,
  PROJECT_ICON_LABELS
} from '../../lib/project-look'
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

const COLOR_NAMES: Record<ProjectColor, string> = {
  red: t('Rojo'),
  orange: t('Naranja'),
  amber: t('Ámbar'),
  green: t('Verde'),
  teal: t('Turquesa'),
  blue: t('Azul'),
  violet: t('Violeta'),
  pink: t('Rosa'),
  gray: t('Gris')
}

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

/** Flechas dentro de un grupo de opciones: mueve la elegida, como un `radiogroup`. */
function onArrows<T>(
  event: KeyboardEvent,
  list: readonly T[],
  current: T,
  pick: (v: T) => void
): void {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const next = list[(list.indexOf(current) + step + list.length) % list.length]
  if (next === undefined) return
  pick(next)
  const group = event.currentTarget as HTMLElement
  void Promise.resolve().then(() =>
    group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  )
}

const ICON_OPTIONS: readonly (ProjectIconId | null)[] = [
  null,
  ...PROJECT_ICONS.filter((i) => i !== 'folder')
]
const COLOR_OPTIONS: readonly (ProjectColor | null)[] = [null, ...PROJECT_COLORS]

const option =
  'inline-flex size-8 items-center justify-center rounded-item transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-offset-0'
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

          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1.5 text-sm font-medium">{{ t('Icono') }}</legend>
            <div
              role="radiogroup"
              :aria-label="t('Icono')"
              class="grid grid-cols-[repeat(auto-fill,2rem)] gap-1"
              @keydown="onArrows($event, ICON_OPTIONS, icon, (v) => (icon = v))"
            >
              <button
                v-for="id in ICON_OPTIONS"
                :key="id ?? 'default'"
                type="button"
                role="radio"
                :aria-checked="icon === id"
                :tabindex="icon === id ? 0 : -1"
                :aria-label="id ? t(PROJECT_ICON_LABELS[id]) : t('Predeterminado')"
                :title="id ? t(PROJECT_ICON_LABELS[id]) : t('Predeterminado')"
                :class="[option, icon === id ? 'bg-surface-hover ring-1 ring-accent' : '']"
                @click="icon = id"
              >
                <ProjectIcon
                  v-if="id === null"
                  :project="{ kind: target?.kind, color: color ?? undefined }"
                />
                <component
                  :is="PROJECT_ICON_COMPONENTS[id]"
                  v-else
                  :size="16"
                  :stroke-width="1.75"
                  :class="color ? PROJECT_COLOR_CLASSES[color].text : ''"
                  aria-hidden="true"
                />
              </button>
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1.5 text-sm font-medium">{{ t('Color') }}</legend>
            <div
              role="radiogroup"
              :aria-label="t('Color')"
              class="flex flex-wrap gap-1"
              @keydown="onArrows($event, COLOR_OPTIONS, color, (v) => (color = v))"
            >
              <button
                v-for="id in COLOR_OPTIONS"
                :key="id ?? 'none'"
                type="button"
                role="radio"
                :aria-checked="color === id"
                :tabindex="color === id ? 0 : -1"
                :aria-label="id ? COLOR_NAMES[id] : t('Sin color')"
                :title="id ? COLOR_NAMES[id] : t('Sin color')"
                :class="[option, color === id ? 'bg-surface-hover ring-1 ring-accent' : '']"
                @click="color = id"
              >
                <Ban v-if="id === null" :size="16" :stroke-width="1.75" class="text-muted" />
                <span
                  v-else
                  :class="[
                    'inline-flex size-5 items-center justify-center rounded-full text-bg',
                    PROJECT_COLOR_CLASSES[id].bg
                  ]"
                >
                  <Check v-if="color === id" :size="12" :stroke-width="2.5" />
                </span>
              </button>
            </div>
          </fieldset>

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
