<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCallView } from '../../../lib/transcript/blocks'
import MarkdownContent from '../MarkdownContent.vue'
import ToolResult from './ToolResult.vue'

/** `AskUserQuestion` (preguntas, opciones y respuesta) y `ExitPlanMode` (el plan en Markdown). */
const props = defineProps<{
  call: ToolCallView
}>()

interface Question {
  question: string
  header?: string
  options: { label: string; description?: string }[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const questions = computed<Question[]>(() => {
  const raw = (props.call.input as { questions?: unknown } | null)?.questions
  if (!Array.isArray(raw)) return []
  return raw.map((q: unknown) => {
    const obj = (q ?? {}) as Record<string, unknown>
    const options = Array.isArray(obj['options']) ? (obj['options'] as unknown[]) : []
    const header = text(obj['header'])
    return {
      question: text(obj['question']),
      ...(header ? { header } : {}),
      options: options.map((o) => {
        const opt = (o ?? {}) as Record<string, unknown>
        const description = text(opt['description'])
        return { label: text(opt['label']), ...(description ? { description } : {}) }
      })
    }
  })
})

const plan = computed(() => text((props.call.input as { plan?: unknown } | null)?.plan))
</script>

<template>
  <div
    v-if="call.name === 'ExitPlanMode'"
    class="max-h-[32rem] overflow-y-auto rounded-item border border-border p-4"
  >
    <MarkdownContent v-if="plan" :source="plan" />
  </div>
  <div v-else class="flex flex-col gap-3">
    <div v-for="(q, index) in questions" :key="index" class="flex flex-col gap-1.5 text-sm">
      <p>
        <span v-if="q.header" class="mr-1.5 rounded-item bg-surface-hover px-1.5 py-0.5 text-xs">
          {{ q.header }}
        </span>
        {{ q.question }}
      </p>
      <ul class="flex flex-col gap-1 pl-1">
        <li v-for="(option, optionIndex) in q.options" :key="optionIndex" class="flex gap-2">
          <span class="text-muted" aria-hidden="true">•</span>
          <span>
            {{ option.label }}
            <span v-if="option.description" class="text-muted">— {{ option.description }}</span>
          </span>
        </li>
      </ul>
    </div>
  </div>
  <ToolResult :call="call" label="Respuesta" />
</template>
