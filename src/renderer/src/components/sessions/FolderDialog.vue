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
import { Folder } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { FOLDER_CONTEXT_MAX, type ProjectColor, type ProjectIcon } from '../../../../shared/types'
import { useFoldersStore } from '../../stores/folders'
import { useSessionsStore } from '../../stores/sessions'
import MarkdownContent from '../transcript/MarkdownContent.vue'
import LookPicker from '../ui/LookPicker.vue'
import SessionLook from './SessionLook.vue'

/**
 * Crear o editar una carpeta de sesiones: nombre, icono, color y contexto en Markdown (con vista
 * previa). Hay uno solo en la app (`App.vue`), abierto con `folders.editing`.
 */
const folders = useFoldersStore()
const sessions = useSessionsStore()

const open = computed({
  get: () => folders.editing !== null,
  set: (value) => {
    if (!value) folders.editing = null
  }
})
const creating = computed(() => folders.editing === 'new')
const name = ref('')
const icon = ref<ProjectIcon | null>(null)
const color = ref<ProjectColor | null>(null)
const context = ref('')
const tab = ref<'write' | 'preview'>('write')
const saving = ref(false)
const input = ref<HTMLInputElement | null>(null)

watch(
  () => folders.editing,
  (editing) => {
    if (!editing) return
    tab.value = 'write'
    if (editing === 'new') {
      name.value = ''
      icon.value = null
      color.value = null
      context.value = ''
    } else {
      name.value = editing.name
      icon.value = editing.icon ?? null
      color.value = editing.color ?? null
      context.value = editing.context
    }
  }
)

const valid = computed(() => name.value.trim() !== '' && context.value.length <= FOLDER_CONTEXT_MAX)

async function save(): Promise<void> {
  const editing = folders.editing
  if (!editing || saving.value || !valid.value) return
  saving.value = true
  if (editing === 'new') {
    const folder = await folders.create({
      name: name.value.trim(),
      icon: icon.value,
      color: color.value,
      context: context.value
    })
    if (folder && folders.createWith.length > 0) {
      await sessions.setFolderMany(folders.createWith, folder.id)
    }
    saving.value = false
    if (folder) {
      folders.createWith = []
      folders.editing = null
    }
    return
  }
  const ok = await folders.update({
    id: editing.id,
    name: name.value.trim(),
    icon: icon.value,
    color: color.value,
    context: context.value
  })
  saving.value = false
  if (ok) folders.editing = null
}

const tabClass =
  'h-7 rounded-item px-2.5 text-sm transition-colors duration-150 hover:bg-surface-hover aria-selected:bg-surface-hover aria-selected:font-medium'
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-dialog bg-surface p-5 text-text shadow-float"
        @open-auto-focus.prevent="input?.select()"
      >
        <DialogTitle class="font-serif text-lg">
          {{ creating ? t('Nueva carpeta') : t('Editar carpeta') }}
        </DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted">
          {{ t('Agrupa sesiones de una misma tarea.') }}
        </DialogDescription>
        <form class="mt-4 flex flex-col gap-4" @submit.prevent="save">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">{{ t('Nombre') }}</span>
            <span class="flex items-center gap-2">
              <span
                class="inline-flex size-9 shrink-0 items-center justify-center rounded-item bg-surface-hover"
              >
                <SessionLook
                  v-if="icon || color"
                  :icon="icon ?? undefined"
                  :color="color ?? undefined"
                  :size="18"
                />
                <Folder v-else :size="18" :stroke-width="1.75" aria-hidden="true" />
              </span>
              <input
                ref="input"
                v-model="name"
                type="text"
                maxlength="100"
                required
                :placeholder="t('Por ejemplo: Migración del login')"
                class="h-9 w-full rounded-item border border-border bg-bg px-3 text-text outline-none placeholder:text-muted focus-visible:border-accent"
              />
            </span>
          </label>

          <LookPicker
            v-model:icon="icon"
            v-model:color="color"
            :default-icon="Folder"
            :no-icon-label="t('Predeterminado')"
            :exclude="['folder']"
          />

          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <span id="folder-context" class="text-sm font-medium">{{ t('Contexto') }}</span>
              <div role="tablist" :aria-label="t('Contexto')" class="ml-auto flex gap-1">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="tab === 'write'"
                  :class="tabClass"
                  @click="tab = 'write'"
                >
                  {{ t('Escribir') }}
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="tab === 'preview'"
                  :class="tabClass"
                  @click="tab = 'preview'"
                >
                  {{ t('Vista previa') }}
                </button>
              </div>
            </div>
            <textarea
              v-if="tab === 'write'"
              v-model="context"
              aria-labelledby="folder-context"
              rows="8"
              spellcheck="false"
              :placeholder="
                t('Qué tarea es, decisiones tomadas, archivos importantes, qué no tocar…')
              "
              class="min-h-40 w-full resize-y rounded-item border border-border bg-bg p-3 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted focus:border-accent"
            />
            <div
              v-else
              class="max-h-80 min-h-40 overflow-y-auto rounded-item border border-border bg-bg p-3"
            >
              <MarkdownContent v-if="context.trim()" :source="context" />
              <p v-else class="text-sm text-muted">{{ t('Sin contexto.') }}</p>
            </div>
            <p class="flex gap-2 text-xs text-muted">
              <span class="min-w-0 flex-1">
                {{
                  t(
                    'Se envía a Claude Code al empezar cada sesión nueva de esta carpeta. No cambia las sesiones ya empezadas.'
                  )
                }}
              </span>
              <span
                class="shrink-0 tabular-nums"
                :class="context.length > FOLDER_CONTEXT_MAX ? 'text-danger' : ''"
                >{{ context.length }} / {{ FOLDER_CONTEXT_MAX }}</span
              >
            </p>
          </div>

          <div class="flex justify-end gap-2">
            <DialogClose
              type="button"
              class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
            >
              {{ t('Cancelar') }}
            </DialogClose>
            <button
              type="submit"
              :disabled="saving || !valid"
              class="h-8 rounded-item bg-accent px-3 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60"
            >
              {{ creating ? t('Crear') : t('Guardar') }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
