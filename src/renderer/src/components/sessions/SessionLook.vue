<script setup lang="ts">
import type { ProjectColor, ProjectIcon } from '../../../../shared/types'
import { PROJECT_COLOR_CLASSES, PROJECT_ICON_COMPONENTS } from '../../lib/project-look'

/**
 * Aspecto de una sesión o carpeta: su icono teñido con su color o, con color y sin icono, una
 * marca de ese color. Sin ninguno de los dos no pinta nada.
 */
withDefaults(
  defineProps<{
    icon?: ProjectIcon | undefined
    color?: ProjectColor | undefined
    size?: number
  }>(),
  { size: 14, icon: undefined, color: undefined }
)
</script>

<template>
  <component
    :is="PROJECT_ICON_COMPONENTS[icon]"
    v-if="icon"
    :size="size"
    :stroke-width="1.75"
    :class="['shrink-0', color ? PROJECT_COLOR_CLASSES[color].text : 'text-muted']"
    aria-hidden="true"
  />
  <span
    v-else-if="color"
    :class="['inline-block size-2 shrink-0 rounded-full', PROJECT_COLOR_CLASSES[color].bg]"
    aria-hidden="true"
  />
</template>
