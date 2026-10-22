<script setup lang="ts">
import { FolderOpen, Pencil } from 'lucide-vue-next'
import { nextTick, ref, useTemplateRef } from 'vue'
import IconButton from '../ui/IconButton.vue'

defineProps<{
  /** Solo muestra la carpeta, sin poder cambiarla (p. ej. durante la conversación). */
  readonly?: boolean
}>()

const emit = defineEmits<{
  pick: []
}>()

/** Carpeta de trabajo; el main la valida al enviar (`INVALID_CWD`). */
const path = defineModel<string | null>({ required: true })

const editing = ref(false)
const typed = ref('')
const input = useTemplateRef<HTMLInputElement>('input')

async function startEditing(): Promise<void> {
  typed.value = path.value ?? ''
  editing.value = true
  await nextTick()
  input.value?.select()
}

function commit(): void {
  const value = typed.value.trim()
  if (value !== '') path.value = value
  editing.value = false
}

// Esc descarta lo escrito; el `blur` posterior confirma entonces la ruta que ya había.
function cancel(): void {
  typed.value = path.value ?? ''
  editing.value = false
}
</script>

<template>
  <!-- Chip de carpeta de trabajo: selector nativo o ruta escrita a mano. -->
  <div class="inline-flex max-w-full min-w-0 items-center gap-0.5 text-sm text-muted">
    <input
      v-if="editing"
      ref="input"
      v-model="typed"
      aria-label="Ruta de la carpeta de trabajo"
      placeholder="C:\ruta\a\la\carpeta"
      class="h-8 w-[28rem] max-w-full rounded-item bg-surface px-2.5 font-mono text-[13px] text-text shadow-float outline-none placeholder:text-muted"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    />
    <template v-else>
      <button
        type="button"
        :disabled="readonly"
        :title="readonly ? (path ?? undefined) : 'Elegir carpeta de trabajo'"
        class="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-item px-2.5 transition-colors duration-150 enabled:hover:bg-surface-hover enabled:hover:text-text"
        @click="emit('pick')"
      >
        <FolderOpen class="shrink-0" :size="16" :stroke-width="1.75" aria-hidden="true" />
        <span v-if="path" class="truncate font-mono text-[13px]">{{ path }}</span>
        <span v-else>Elegir carpeta de trabajo</span>
      </button>
      <IconButton v-if="!readonly" :icon="Pencil" label="Escribir la ruta" @click="startEditing" />
    </template>
  </div>
</template>
