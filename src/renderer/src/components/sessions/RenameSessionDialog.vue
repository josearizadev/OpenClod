<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useSessionsStore } from '../../stores/sessions'

/**
 * Renombrar una sesión. El título se guarda en `state.json`, nunca en la
 * carpeta de Claude Code; vacío vuelve al título automático. Hay uno solo en la app (`App.vue`).
 */
const sessions = useSessionsStore()

const open = computed({
  get: () => sessions.renaming !== null,
  set: (value) => {
    if (!value) sessions.renaming = null
  }
})
const title = ref('')
const saving = ref(false)
const input = ref<HTMLInputElement | null>(null)

watch(
  () => sessions.renaming,
  async (target) => {
    if (!target) return
    title.value = target.title
    await nextTick()
    input.value?.select()
  }
)

async function save(): Promise<void> {
  const target = sessions.renaming
  if (!target || saving.value) return
  saving.value = true
  await sessions.update(target.sessionId, { title: title.value.trim() || null })
  saving.value = false
  sessions.renaming = null
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 w-[min(26.25rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-dialog bg-surface p-5 text-text shadow-float"
        @open-auto-focus.prevent="input?.select()"
      >
        <DialogTitle class="font-serif text-lg">Renombrar sesión</DialogTitle>
        <form class="mt-4 flex flex-col gap-2" @submit.prevent="save">
          <input
            ref="input"
            v-model="title"
            type="text"
            maxlength="200"
            aria-label="Título de la sesión"
            class="h-9 w-full rounded-item border border-border bg-bg px-3 text-text outline-none focus-visible:border-accent"
          />
          <DialogDescription class="text-sm text-muted">
            Déjalo vacío para usar el título automático.
          </DialogDescription>
          <div class="mt-3 flex justify-end gap-2">
            <DialogClose
              type="button"
              class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
            >
              Cancelar
            </DialogClose>
            <button
              type="submit"
              :disabled="saving"
              class="h-8 rounded-item bg-accent px-3 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60"
            >
              Guardar
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
