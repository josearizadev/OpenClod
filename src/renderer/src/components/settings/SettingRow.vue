<script setup lang="ts">
/** Fila de Ajustes: etiqueta y descripción a la izquierda, control a la derecha. */
defineProps<{
  label: string
  description?: string
  /** `id` del control, para enlazar la etiqueta. */
  for?: string
  disabled?: boolean
}>()
</script>

<template>
  <div class="flex min-w-0 items-center gap-4 py-3" :class="disabled ? 'opacity-50' : ''">
    <div class="min-w-0 flex-1">
      <label :for="$props.for" class="block text-sm">{{ label }}</label>
      <p v-if="description" class="text-xs text-muted">{{ description }}</p>
      <slot name="extra" />
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot />
    </div>
  </div>
</template>
