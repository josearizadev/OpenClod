<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  /** Nombre accesible; también se muestra como tooltip nativo. */
  label: string
  disabled?: boolean
}>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    class="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
  >
    <component :is="icon" :size="18" :stroke-width="1.75" />
  </button>
</template>
