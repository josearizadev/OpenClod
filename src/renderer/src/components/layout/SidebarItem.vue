<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  label: string
  icon?: Component
  /** Si se indica, el ítem es un enlace del router; si no, un botón. */
  to?: RouteLocationRaw
  disabled?: boolean
  /** En el riel plegado solo se ve el icono; la etiqueta pasa a tooltip. */
  collapsed?: boolean
}>()

const itemClass = computed(() => [
  'no-drag flex h-8 w-full items-center gap-2.5 rounded-item px-2 text-left text-text transition-colors duration-150',
  'hover:bg-surface-hover aria-[current=page]:bg-surface-hover focus-visible:outline-offset-[-2px]',
  'disabled:pointer-events-none disabled:text-muted',
  props.collapsed ? 'justify-center' : ''
])
</script>

<template>
  <RouterLink
    v-if="to && !disabled"
    :to="to"
    :class="itemClass"
    :title="collapsed ? label : undefined"
    :aria-label="collapsed ? label : undefined"
  >
    <component :is="icon" v-if="icon" :size="18" :stroke-width="1.75" class="shrink-0" />
    <span v-if="!collapsed" class="truncate">{{ label }}</span>
  </RouterLink>
  <button
    v-else
    type="button"
    :disabled="disabled"
    :class="itemClass"
    :title="collapsed ? label : undefined"
    :aria-label="collapsed ? label : undefined"
  >
    <component :is="icon" v-if="icon" :size="18" :stroke-width="1.75" class="shrink-0" />
    <span v-if="!collapsed" class="truncate">{{ label }}</span>
  </button>
</template>
