<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

/** Interruptor de Ajustes (Reka `Switch`). */
const model = defineModel<boolean>({ required: true })
defineProps<{ id?: string; disabled?: boolean; label?: string }>()
</script>

<template>
  <SwitchRoot
    :id="id"
    v-model="model"
    :disabled="disabled"
    :aria-label="label"
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-muted transition-colors duration-150 data-[state=checked]:bg-accent disabled:cursor-not-allowed"
  >
    <SwitchThumb
      class="block size-4 translate-x-0.5 rounded-full bg-surface shadow-float transition-transform duration-150 data-[state=checked]:translate-x-[18px]"
    />
  </SwitchRoot>
</template>
