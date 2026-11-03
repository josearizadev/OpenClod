<script setup lang="ts">
import { t } from '../../i18n'
import { Ban, Check } from 'lucide-vue-next'
import type { Component } from 'vue'
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColor,
  type ProjectIcon as ProjectIconId
} from '../../../../shared/types'
import {
  PROJECT_COLOR_CLASSES,
  PROJECT_COLOR_NAMES,
  PROJECT_ICON_COMPONENTS,
  PROJECT_ICON_LABELS
} from '../../lib/project-look'

/**
 * Elegir icono y color del catálogo de proyectos (proyectos, sesiones y carpetas). Cada grupo es
 * un `radiogroup`: las flechas mueven la opción elegida. `defaultIcon` es lo que se ve en la
 * opción «sin icono».
 */
const props = defineProps<{
  defaultIcon: Component
  /** Etiqueta de la opción sin icono. */
  noIconLabel: string
  /** Iconos que no se ofrecen (p. ej. el de carpeta, que ya es el predeterminado). */
  exclude?: readonly ProjectIconId[]
}>()

const icon = defineModel<ProjectIconId | null>('icon', { required: true })
const color = defineModel<ProjectColor | null>('color', { required: true })

const ICON_OPTIONS: readonly (ProjectIconId | null)[] = [
  null,
  ...PROJECT_ICONS.filter((i) => !props.exclude?.includes(i))
]
const COLOR_OPTIONS: readonly (ProjectColor | null)[] = [null, ...PROJECT_COLORS]

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

const option =
  'inline-flex size-8 items-center justify-center rounded-item transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-offset-0'
</script>

<template>
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
        :aria-label="id ? t(PROJECT_ICON_LABELS[id]) : noIconLabel"
        :title="id ? t(PROJECT_ICON_LABELS[id]) : noIconLabel"
        :class="[option, icon === id ? 'bg-surface-hover ring-1 ring-accent' : '']"
        @click="icon = id"
      >
        <component
          :is="id === null ? defaultIcon : PROJECT_ICON_COMPONENTS[id]"
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
        :aria-label="id ? t(PROJECT_COLOR_NAMES[id]) : t('Sin color')"
        :title="id ? t(PROJECT_COLOR_NAMES[id]) : t('Sin color')"
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
</template>
