<script setup lang="ts">
import { t } from '../../i18n'
import { Terminal } from 'lucide-vue-next'
import { computed } from 'vue'
import { tag } from '../../i18n'
import type { ToolCallView } from '../../lib/transcript/blocks'
import type { TouchedFile } from '../../lib/transcript/files'
import EditDiff from '../transcript/tools/EditDiff.vue'
import WriteContent from '../transcript/tools/WriteContent.vue'

/**
 * Cambios de la sesión sobre un archivo: un diff por llamada, en orden y con su hora, con
 * los componentes del visor. Lo detectado por comando se lista sin diff.
 */
const props = defineProps<{ file: TouchedFile; cwd?: string }>()

const OPS = {
  deleted: t('Borrado'),
  created: t('Creado'),
  'moved-from': t('Movido a otra ruta'),
  'moved-to': t('Movido aquí')
} as const

const TOOLS = {
  Write: t('Escritura completa'),
  Edit: t('Edición'),
  MultiEdit: t('Ediciones'),
  NotebookEdit: t('Celda de notebook')
} as const

function time(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
}

const calls = computed(() =>
  props.file.changes.map((change) => ({
    change,
    call: {
      id: change.toolUseId,
      name: change.tool === 'NotebookEdit' ? 'Write' : change.tool,
      input:
        change.tool === 'NotebookEdit'
          ? {
              file_path: (change.input as { notebook_path?: string }).notebook_path,
              content: (change.input as { new_source?: string }).new_source ?? ''
            }
          : change.input,
      status: change.status === 'running' ? 'running' : 'ok'
    } satisfies ToolCallView
  }))
)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <section
      v-for="{ change, call } in calls"
      :key="change.toolUseId"
      class="flex min-w-0 flex-col gap-1"
    >
      <p class="flex items-center gap-2 text-xs text-muted">
        <span class="font-medium text-text">{{ TOOLS[change.tool] }}</span>
        <span v-if="time(change.timestamp)">{{ time(change.timestamp) }}</span>
        <span v-if="change.status === 'running'">· {{ t('en curso') }}</span>
        <span class="ml-auto tabular-nums">
          <span class="text-diff-add">+{{ change.added }}</span>
          <span class="ml-1 text-diff-del">−{{ change.removed }}</span>
        </span>
      </p>
      <WriteContent v-if="call.name === 'Write'" :call="call" :cwd="cwd" />
      <EditDiff v-else :call="call" />
    </section>
    <section v-if="file.commands.length > 0" class="flex flex-col gap-1">
      <p class="text-xs font-medium">{{ t('Detectado por comando') }}</p>
      <p
        v-for="(op, index) in file.commands"
        :key="`${op.toolUseId}:${index}`"
        class="flex min-w-0 items-center gap-2 text-xs text-muted"
      >
        <Terminal class="shrink-0" :size="12" :stroke-width="1.75" aria-hidden="true" />
        <span class="shrink-0">{{ OPS[op.op] }}</span>
        <code class="min-w-0 truncate font-mono" :title="op.command">{{ op.command }}</code>
        <span v-if="time(op.timestamp)" class="ml-auto shrink-0">{{ time(op.timestamp) }}</span>
      </p>
    </section>
  </div>
</template>
