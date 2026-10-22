<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallView } from '../../../lib/transcript/blocks'
import { lineDiff, type DiffRow } from '../../../lib/transcript/diff'
import ToolResult from './ToolResult.vue'

/** `Edit` y `MultiEdit`: diff de `old_string` → `new_string` con los tokens de diff. */
const props = defineProps<{
  call: ToolCallView
}>()

interface Change {
  old_string?: unknown
  new_string?: unknown
}

const MAX_ROWS = 400

const hunks = computed<DiffRow[][]>(() => {
  const input = (props.call.input ?? {}) as Change & { edits?: unknown }
  const edits: Change[] = Array.isArray(input.edits) ? (input.edits as Change[]) : [input]
  return edits.map((edit) =>
    lineDiff(
      typeof edit.old_string === 'string' ? edit.old_string : '',
      typeof edit.new_string === 'string' ? edit.new_string : ''
    )
  )
})
const total = computed(() => hunks.value.reduce((n, h) => n + h.length, 0))
const showAll = ref(false)

/** Filas visibles: las primeras `MAX_ROWS` salvo «Mostrar todo». */
const visible = computed(() => {
  if (showAll.value) return hunks.value
  let left = MAX_ROWS
  return hunks.value.map((hunk) => {
    const rows = hunk.slice(0, Math.max(0, left))
    left -= rows.length
    return rows
  })
})

function sign(row: DiffRow): string {
  return row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <div class="overflow-x-auto rounded-item bg-code-bg py-1 font-mono text-[13px] leading-relaxed">
      <div class="w-max min-w-full">
        <template v-for="(hunk, index) in visible" :key="index">
          <div v-if="index > 0" class="my-1 border-t border-border" />
          <template v-for="(row, rowIndex) in hunk" :key="rowIndex">
            <div v-if="row.type === 'skip'" class="px-3 text-xs text-muted select-none">
              ⋯ {{ row.count }} {{ row.count === 1 ? 'línea sin cambios' : 'líneas sin cambios' }}
            </div>
            <div
              v-else
              class="flex px-3 whitespace-pre"
              :class="{
                'bg-diff-add-bg': row.type === 'add',
                'bg-diff-del-bg': row.type === 'del'
              }"
            >
              <span
                class="w-4 shrink-0 select-none"
                :class="{
                  'text-diff-add': row.type === 'add',
                  'text-diff-del': row.type === 'del',
                  'text-muted': row.type === 'ctx'
                }"
                aria-hidden="true"
                v-text="sign(row)"
              />
              <span v-if="row.type !== 'ctx'" class="sr-only">{{
                row.type === 'add' ? 'Añadida:' : 'Quitada:'
              }}</span>
              <span v-text="row.text || ' '" />
            </div>
          </template>
        </template>
      </div>
    </div>
    <button
      v-if="total > MAX_ROWS"
      type="button"
      class="w-fit rounded-item px-1 text-xs text-muted underline underline-offset-2 hover:text-text"
      :aria-expanded="showAll"
      @click="showAll = !showAll"
    >
      {{ showAll ? 'Mostrar menos' : `Mostrar todo (${total} líneas)` }}
    </button>
  </div>
  <ToolResult v-if="!call.result || call.result.isError" :call="call" />
</template>
