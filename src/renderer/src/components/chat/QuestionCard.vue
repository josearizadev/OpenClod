<script setup lang="ts">
import { CircleHelp } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import type { PermissionRequestView } from '../../../../shared/chat'

/**
 * `AskUserQuestion` interactivo: cada pregunta con su encabezado, opciones de selección
 * única o múltiple, «Otra» con texto libre y la vista previa de la opción enfocada. Las respuestas
 * vuelven a Claude por clave = texto de la pregunta (varias, separadas por comas).
 */
const props = defineProps<{ request: PermissionRequestView }>()
const emit = defineEmits<{ answer: [answers: Record<string, string>]; skip: [] }>()

interface Option {
  label: string
  description?: string
  preview?: string
}
interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: Option[]
}

const questions = computed<Question[]>(() => {
  const input = props.request.input as { questions?: unknown }
  if (!Array.isArray(input?.questions)) return []
  return input.questions
    .filter(
      (q): q is Question =>
        typeof q === 'object' && q !== null && typeof (q as Question).question === 'string'
    )
    .map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options : [] }))
})

const OTHER = '__otra__'
/** Elegidas por pregunta (índice). */
const picked = reactive<Record<number, string[]>>({})
const other = reactive<Record<number, string>>({})
const focused = ref<{ q: number; label: string } | null>(null)

function toggle(index: number, label: string, multi: boolean | undefined): void {
  const current = picked[index] ?? []
  if (!multi) picked[index] = [label]
  else
    picked[index] = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label]
}

function answerOf(index: number): string {
  return (picked[index] ?? [])
    .map((label) => (label === OTHER ? (other[index] ?? '').trim() : label))
    .filter(Boolean)
    .join(', ')
}

const complete = computed(() => questions.value.every((_, i) => answerOf(i) !== ''))

function submit(): void {
  if (!complete.value) return
  const answers: Record<string, string> = {}
  questions.value.forEach((q, i) => (answers[q.question] = answerOf(i).slice(0, 2000)))
  emit('answer', answers)
}

const previewText = computed(() => {
  const f = focused.value
  if (!f) return ''
  return questions.value[f.q]?.options.find((o) => o.label === f.label)?.preview ?? ''
})
</script>

<template>
  <section
    class="flex flex-col gap-4 rounded-menu border border-border bg-surface p-4 shadow-float"
    aria-label="Pregunta de Claude"
  >
    <header class="flex items-center gap-2 text-sm">
      <CircleHelp class="shrink-0 text-accent" :size="18" :stroke-width="1.75" aria-hidden="true" />
      Claude te pregunta
    </header>

    <fieldset v-for="(q, i) in questions" :key="q.question" class="flex flex-col gap-2">
      <legend class="mb-1 flex flex-wrap items-center gap-2 text-sm">
        <span
          v-if="q.header"
          class="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
          >{{ q.header }}</span
        >
        <span>{{ q.question }}</span>
      </legend>
      <label
        v-for="option in q.options"
        :key="option.label"
        class="flex cursor-pointer items-start gap-2 rounded-item px-2 py-1.5 text-sm hover:bg-surface-hover"
      >
        <input
          :type="q.multiSelect ? 'checkbox' : 'radio'"
          :name="`q${i}`"
          class="mt-1 accent-accent"
          :checked="(picked[i] ?? []).includes(option.label)"
          @change="toggle(i, option.label, q.multiSelect)"
          @focus="focused = { q: i, label: option.label }"
        />
        <span class="flex min-w-0 flex-col">
          <span>{{ option.label }}</span>
          <span v-if="option.description" class="text-xs text-muted">{{ option.description }}</span>
        </span>
      </label>
      <label class="flex items-center gap-2 rounded-item px-2 py-1.5 text-sm">
        <input
          :type="q.multiSelect ? 'checkbox' : 'radio'"
          :name="`q${i}`"
          class="accent-accent"
          :checked="(picked[i] ?? []).includes(OTHER)"
          @change="toggle(i, OTHER, q.multiSelect)"
        />
        <span class="shrink-0">Otra:</span>
        <input
          v-model="other[i]"
          maxlength="2000"
          :aria-label="`Otra respuesta a «${q.question}»`"
          class="h-8 min-w-0 flex-1 rounded-item border border-border bg-bg px-2 outline-none focus-visible:border-accent"
          @focus="(picked[i] ?? []).includes(OTHER) || toggle(i, OTHER, q.multiSelect)"
        />
      </label>
    </fieldset>

    <pre
      v-if="previewText"
      class="max-h-48 overflow-auto rounded-item bg-code-bg p-2 font-mono text-xs whitespace-pre-wrap"
      >{{ previewText }}</pre>

    <div class="flex items-center gap-2">
      <button
        type="button"
        :disabled="!complete"
        class="h-8 rounded-item bg-accent px-3 text-sm text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
        @click="submit"
      >
        Responder
      </button>
      <button
        type="button"
        class="h-8 rounded-item px-3 text-sm text-muted hover:bg-surface-hover hover:text-text"
        @click="emit('skip')"
      >
        No responder
      </button>
    </div>
  </section>
</template>
