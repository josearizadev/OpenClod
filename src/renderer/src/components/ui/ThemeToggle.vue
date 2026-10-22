<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot, type AcceptableValue } from 'reka-ui'
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import type { Theme } from '../../../../shared/types'
import { useUiStore } from '../../stores/ui'

const { vertical = false } = defineProps<{
  /** En el riel plegado de la barra lateral las opciones se apilan. */
  vertical?: boolean
}>()

const ui = useUiStore()

const options = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon }
] as const satisfies readonly { value: Theme; label: string; icon: unknown }[]

function isTheme(value: AcceptableValue | AcceptableValue[]): value is Theme {
  return options.some((option) => option.value === value)
}

function onChange(value: AcceptableValue | AcceptableValue[]): void {
  // Volver a pulsar la opción activa la deseleccionaría: se ignora.
  if (isTheme(value) && value !== ui.theme) void ui.setTheme(value)
}
</script>

<template>
  <ToggleGroupRoot
    type="single"
    :model-value="ui.theme"
    aria-label="Tema"
    :orientation="vertical ? 'vertical' : 'horizontal'"
    :class="[
      'no-drag inline-flex gap-0.5 rounded-item bg-surface-hover p-0.5',
      vertical ? 'flex-col' : ''
    ]"
    @update:model-value="onChange"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :aria-label="option.label"
      :title="option.label"
      class="rounded-[6px] p-1.5 text-muted transition-colors duration-150 hover:text-text data-[state=on]:bg-surface data-[state=on]:text-text data-[state=on]:shadow-float"
    >
      <component :is="option.icon" :size="16" :stroke-width="1.75" />
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
