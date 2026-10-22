<script setup lang="ts">
import { Brain, ChevronRight } from 'lucide-vue-next'
import { useFoldState } from '../../composables/useFoldState'

/** «Pensó» plegable; sin texto, una línea sin desplegable. */
const props = defineProps<{
  foldKey: string
  text: string
}>()

const fold = useFoldState()
</script>

<template>
  <div class="flex flex-col gap-1 text-sm text-muted">
    <button
      v-if="props.text"
      type="button"
      class="flex w-fit items-center gap-1.5 rounded-item py-0.5 pr-2 hover:text-text"
      :aria-expanded="fold.isOpen(props.foldKey)"
      @click="fold.toggle(props.foldKey)"
    >
      <Brain :size="16" :stroke-width="1.75" aria-hidden="true" />
      Pensó
      <ChevronRight
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
        class="transition-transform duration-150 motion-reduce:transition-none"
        :class="fold.isOpen(props.foldKey) ? 'rotate-90' : ''"
      />
    </button>
    <p v-else class="flex items-center gap-1.5 py-0.5">
      <Brain :size="16" :stroke-width="1.75" aria-hidden="true" />
      Pensó
    </p>
    <p
      v-if="props.text && fold.isOpen(props.foldKey)"
      class="border-l-2 border-border pl-3 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
      v-text="props.text"
    />
  </div>
</template>
