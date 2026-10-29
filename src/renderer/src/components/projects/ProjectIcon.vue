<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectView } from '../../../../shared/projects'
import { projectColorClass, projectIcon } from '../../lib/project-look'

/** Icono de un proyecto con su color (o el de carpeta si no hay ninguno). */
const props = withDefaults(
  defineProps<{
    project:
      (Pick<ProjectView, 'icon' | 'color' | 'kind'> & { missing?: boolean }) | null | undefined
    size?: number
  }>(),
  { size: 16 }
)

const icon = computed(() => projectIcon(props.project))
const color = computed(() => projectColorClass(props.project))
</script>

<template>
  <component
    :is="icon"
    :size="size"
    :stroke-width="1.75"
    :class="['shrink-0', color]"
    aria-hidden="true"
  />
</template>
