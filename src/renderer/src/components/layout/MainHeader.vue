<script setup lang="ts">
import GitChip from '../git/GitChip.vue'
import UsageMeter from '../usage/UsageMeter.vue'

defineProps<{
  title: string
}>()
</script>

<template>
  <!--
    Toda la cabecera arrastra la ventana. A la derecha se reserva el hueco de los botones
    nativos (titleBarOverlay): `titlebar-area-*` lo da Electron; sin overlay vale 0.
  -->
  <header class="main-header drag-region relative flex h-12 shrink-0 items-center justify-end px-4">
    <h1
      class="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-sm font-medium"
    >
      {{ title }}
    </h1>
    <GitChip />
    <UsageMeter />
    <slot name="actions" />
  </header>
</template>

<style scoped>
.main-header {
  padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 1rem);
}
</style>
