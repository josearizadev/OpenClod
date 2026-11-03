<script setup lang="ts">
import { t } from '../../i18n'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { MessageSquare } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { ProjectColor, ProjectIcon } from '../../../../shared/types'
import { useSessionsStore } from '../../stores/sessions'
import LookPicker from '../ui/LookPicker.vue'

/**
 * «Personalizar…» de una o varias sesiones: icono y color, guardados por conversación en
 * `state.json`. Hay uno solo en la app (`App.vue`), abierto con `sessions.lookRequest`.
 */
const sessions = useSessionsStore()

const open = computed({
  get: () => sessions.lookRequest !== null,
  set: (value) => {
    if (!value) sessions.lookRequest = null
  }
})
const icon = ref<ProjectIcon | null>(null)
const color = ref<ProjectColor | null>(null)
const saving = ref(false)

const targets = computed(() => sessions.lookRequest ?? [])
const first = computed(() => sessions.items.find((i) => i.sessionId === targets.value[0]))

watch(targets, (ids) => {
  if (ids.length === 0) return
  // Con varias, se parte del aspecto de la primera.
  icon.value = first.value?.icon ?? null
  color.value = first.value?.color ?? null
})

async function save(): Promise<void> {
  if (saving.value || targets.value.length === 0) return
  saving.value = true
  await sessions.setLookMany(targets.value, { icon: icon.value, color: color.value })
  saving.value = false
  sessions.lookRequest = null
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-dialog bg-surface p-5 text-text shadow-float"
      >
        <DialogTitle class="font-serif text-lg">
          {{
            targets.length > 1
              ? t('Personalizar {n} sesiones', { n: targets.length })
              : t('Personalizar sesión')
          }}
        </DialogTitle>
        <DialogDescription class="mt-1 truncate text-sm text-muted">
          {{ targets.length > 1 ? t('El icono y el color se aplican a todas.') : first?.title }}
        </DialogDescription>
        <form class="mt-4 flex flex-col gap-4" @submit.prevent="save">
          <LookPicker
            v-model:icon="icon"
            v-model:color="color"
            :default-icon="MessageSquare"
            :no-icon-label="t('Sin icono')"
          />
          <p v-if="sessions.error" class="text-sm text-danger" role="alert">
            {{ sessions.error }}
          </p>
          <div class="flex justify-end gap-2">
            <DialogClose
              type="button"
              class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
            >
              {{ t('Cancelar') }}
            </DialogClose>
            <button
              type="submit"
              :disabled="saving"
              class="h-8 rounded-item bg-accent px-3 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60"
            >
              {{ t('Guardar') }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
