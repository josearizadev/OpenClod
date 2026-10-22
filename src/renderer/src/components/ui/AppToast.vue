<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore, type Toast } from '../../stores/ui'

/** Aviso breve con acción opcional. Desaparece a los 6 s. */
const ui = useUiStore()
const shown = ref<Toast | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

function hide(): void {
  if (timer) clearTimeout(timer)
  timer = null
  shown.value = null
}

watch(
  () => ui.toastState,
  (toast) => {
    if (!toast) return
    if (timer) clearTimeout(timer)
    shown.value = toast
    timer = setTimeout(hide, 6000)
  }
)
onBeforeUnmount(hide)

function act(): void {
  shown.value?.action?.run()
  hide()
}
</script>

<template>
  <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex justify-end" aria-live="polite">
    <div
      v-if="shown"
      :key="shown.id"
      class="pointer-events-auto flex max-w-[min(28rem,calc(100vw-2rem))] items-center gap-3 rounded-menu bg-surface py-2 pr-2 pl-4 text-sm shadow-float"
      :class="shown.tone === 'danger' ? 'border border-danger' : ''"
      role="status"
    >
      <span class="min-w-0 flex-1" :class="shown.tone === 'danger' ? 'text-danger' : ''">{{
        shown.text
      }}</span>
      <button
        v-if="shown.action"
        type="button"
        class="shrink-0 rounded-item px-2 py-1 font-medium text-accent hover:text-accent-hover"
        @click="act"
      >
        {{ shown.action.label }}
      </button>
      <button
        type="button"
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-item text-muted hover:bg-surface-hover hover:text-text"
        aria-label="Cerrar el aviso"
        @click="hide"
      >
        <X :size="16" :stroke-width="1.75" />
      </button>
    </div>
  </div>
</template>
