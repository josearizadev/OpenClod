<script setup lang="ts">
import { Link2 } from 'lucide-vue-next'
import { computed } from 'vue'
import { dayHeading, shortDateTime } from '../../lib/dates'
import type { Block } from '../../lib/transcript/blocks'

/** Separador de fecha o «Reanudada aquí». */
const props = defineProps<{
  block: Extract<Block, { kind: 'separator' }>
}>()

const label = computed(() => {
  if (props.block.variant === 'date') {
    const day = dayHeading(props.block.date, new Date())
    return day.charAt(0).toUpperCase() + day.slice(1)
  }
  const when = shortDateTime(props.block.date)
  return when ? `Reanudada aquí · ${when}` : 'Reanudada aquí'
})
</script>

<template>
  <div class="flex items-center gap-3 py-1 text-xs text-muted" role="separator">
    <span class="h-px flex-1 bg-border" />
    <span class="flex items-center gap-1.5">
      <Link2
        v-if="block.variant === 'resumed'"
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      {{ label }}
    </span>
    <span class="h-px flex-1 bg-border" />
  </div>
</template>
