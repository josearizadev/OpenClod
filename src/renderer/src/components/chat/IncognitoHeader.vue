<script setup lang="ts">
import { t } from '../../i18n'
import { Ghost } from 'lucide-vue-next'

/** Cabecera de una sesión de incógnito: no tiene ficha en el índice. */
defineProps<{
  scrolled: boolean
  /** «Trabajando…», «Pensando…»: lo que hace Claude ahora. */
  activity?: string | null
}>()
</script>

<template>
  <header
    class="shrink-0 border-b px-6 py-2 transition-colors duration-150"
    :class="scrolled ? 'border-border' : 'border-transparent'"
  >
    <div class="mx-auto flex max-w-chat min-w-0 items-center gap-2">
      <Ghost class="shrink-0" :size="20" :stroke-width="1.75" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 flex-col">
        <h2 class="truncate font-serif text-lg leading-snug">{{ t('Incógnito') }}</h2>
        <p class="truncate text-xs text-muted">
          <span v-if="activity" class="font-medium text-accent" role="status">{{ activity }}</span>
          <span v-if="activity" aria-hidden="true"> · </span>
          {{ t('Esta conversación no se guarda: se borra al cerrar la pestaña.') }}
        </p>
      </div>
      <slot name="actions" />
    </div>
  </header>
</template>
