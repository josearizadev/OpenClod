<script setup lang="ts">
import { t } from '../../i18n'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle
} from 'reka-ui'

/** Confirmación genérica. El foco empieza en «Cancelar». */
const open = defineModel<boolean>('open', { required: true })

defineProps<{
  title: string
  description: string
  confirmLabel: string
  /** La acción no se puede deshacer o es destructiva: botón en `--danger`. */
  danger?: boolean
}>()

const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <AlertDialogContent
        class="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-dialog bg-surface p-5 text-text shadow-float"
      >
        <AlertDialogTitle class="font-serif text-lg">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 text-muted">{{ description }}</AlertDialogDescription>
        <div class="mt-5 flex justify-end gap-2">
          <AlertDialogCancel
            class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
          >
            {{ t('Cancelar') }}
          </AlertDialogCancel>
          <AlertDialogAction
            :class="[
              'h-8 rounded-item px-3 text-on-accent transition-colors duration-150',
              danger ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover'
            ]"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
