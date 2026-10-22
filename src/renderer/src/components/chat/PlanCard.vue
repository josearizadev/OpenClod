<script setup lang="ts">
import { ClipboardList } from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { PermissionRequestView } from '../../../../shared/chat'
import MarkdownContent from '../transcript/MarkdownContent.vue'

/** `ExitPlanMode`: el plan en Markdown con **Aprobar** y **Seguir planificando**. */
const props = defineProps<{ request: PermissionRequestView }>()
const emit = defineEmits<{ approve: []; keepPlanning: [comment: string] }>()

const plan = computed(() => {
  const input = props.request.input as { plan?: unknown }
  return typeof input?.plan === 'string' ? input.plan : ''
})

const commenting = ref(false)
const comment = ref('')
const commentInput = useTemplateRef<HTMLTextAreaElement>('commentInput')

async function startComment(): Promise<void> {
  commenting.value = true
  await nextTick()
  commentInput.value?.focus()
}
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-menu border border-border bg-surface p-4 shadow-float"
    aria-label="Plan propuesto"
  >
    <header class="flex items-center gap-2 text-sm">
      <ClipboardList
        class="shrink-0 text-accent"
        :size="18"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      Claude propone este plan
    </header>
    <div class="max-h-96 overflow-auto rounded-item border border-border px-4 py-2">
      <MarkdownContent :source="plan || '*(sin texto)*'" />
    </div>
    <form
      v-if="commenting"
      class="flex flex-col gap-2"
      @submit.prevent="emit('keepPlanning', comment.trim())"
    >
      <textarea
        ref="commentInput"
        v-model="comment"
        rows="2"
        maxlength="2000"
        aria-label="Qué cambiar del plan (opcional)"
        placeholder="Qué cambiar del plan (opcional)"
        class="w-full resize-y rounded-item border border-border bg-bg px-2 py-1.5 text-sm outline-none placeholder:text-muted focus-visible:border-accent"
      />
      <div class="flex gap-2">
        <button
          type="submit"
          class="h-8 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover"
        >
          Enviar comentario
        </button>
        <button
          type="button"
          class="h-8 rounded-item px-3 text-sm text-muted hover:bg-surface-hover hover:text-text"
          @click="commenting = false"
        >
          Cancelar
        </button>
      </div>
    </form>
    <div v-else class="flex gap-2">
      <button
        type="button"
        class="h-8 rounded-item bg-accent px-3 text-sm text-on-accent transition-colors duration-150 hover:bg-accent-hover"
        @click="emit('approve')"
      >
        Aprobar
      </button>
      <button
        type="button"
        class="h-8 rounded-item border border-border px-3 text-sm hover:bg-surface-hover"
        @click="startComment"
      >
        Seguir planificando
      </button>
    </div>
  </section>
</template>
