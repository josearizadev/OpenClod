<script setup lang="ts">
import { computed } from 'vue'
import type { FileDiff } from '../../../../shared/files'
import type { ToolCallView } from '../../lib/transcript/blocks'
import { changeCounts } from '../../lib/transcript/files'
import EditDiff from '../transcript/tools/EditDiff.vue'

/**
 * Diff de un archivo contra `HEAD`: se calcula en el renderer con el
 * mismo `lineDiff` y el mismo componente que los diffs de la sesión.
 */
const props = defineProps<{ diff: FileDiff }>()

const call = computed<ToolCallView | null>(() => {
  const d = props.diff
  if (d.kind !== 'text') return null
  return {
    id: `git:${d.path}`,
    name: 'Edit',
    input: { file_path: d.path, old_string: d.before ?? '', new_string: d.after ?? '' },
    result: { text: '', isError: false },
    status: 'ok'
  }
})

const counts = computed(() => (call.value ? changeCounts('Edit', call.value.input) : null))

const label = computed(() => {
  const d = props.diff
  if (d.kind !== 'text') return ''
  if (d.before === null) return 'Archivo nuevo'
  if (d.after === null) return 'Archivo borrado'
  return 'Cambios respecto a HEAD'
})

const NOTICE: Partial<Record<FileDiff['kind'], string>> = {
  unchanged: 'Sin cambios respecto a HEAD.',
  'not-repo': 'Esta carpeta no es un repositorio Git.',
  binary: 'Archivo binario: no se puede comparar.',
  'too-large': 'Archivo demasiado grande para compararlo.',
  secret: 'Diff desactivado: puede contener secretos.',
  outside: 'El archivo está fuera de la carpeta de la sesión.'
}
</script>

<template>
  <div v-if="call && counts" class="flex min-w-0 flex-col gap-1">
    <p class="flex items-center gap-2 text-xs text-muted">
      <span class="font-medium text-text">{{ label }}</span>
      <span class="ml-auto tabular-nums">
        <span class="text-diff-add">+{{ counts.added }}</span>
        <span class="ml-1 text-diff-del">−{{ counts.removed }}</span>
      </span>
    </p>
    <EditDiff :call="call" />
  </div>
  <p v-else class="py-2 text-sm text-muted">{{ NOTICE[diff.kind] }}</p>
</template>
