<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatNumber } from '../../lib/tokens'
import { truncateText } from '../../lib/transcript/truncate'

/**
 * Texto monoespaciado largo (salidas y entradas de herramientas): solo el principio y
 * «Mostrar todo (N líneas)». Scroll horizontal propio, nunca en la página.
 */
const props = defineProps<{
  text: string
}>()

const showAll = ref(false)
const cut = computed(() => truncateText(props.text))
const visible = computed(() => (showAll.value ? props.text : cut.value.head))
</script>

<template>
  <div class="flex min-w-0 flex-col items-start gap-1">
    <pre
      class="w-full overflow-x-auto rounded-item bg-code-bg px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre text-text"
      >{{ visible }}</pre>
    <button
      v-if="cut.truncated"
      type="button"
      class="rounded-item px-1 text-xs text-muted underline underline-offset-2 hover:text-text"
      :aria-expanded="showAll"
      @click="showAll = !showAll"
    >
      {{
        showAll
          ? 'Mostrar menos'
          : `Mostrar todo (${formatNumber(cut.totalLines)} ${cut.totalLines === 1 ? 'línea' : 'líneas'})`
      }}
    </button>
  </div>
</template>
