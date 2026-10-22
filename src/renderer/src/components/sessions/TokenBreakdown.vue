<script setup lang="ts">
import { computed } from 'vue'
import type { TokenUsage } from '../../../../shared/sessions'
import { tokenBreakdown } from '../../lib/tokens'

/** Desglose de tokens: en el tooltip de la lista y en la ficha. */
const props = defineProps<{ usage: TokenUsage }>()
const rows = computed(() => tokenBreakdown(props.usage))
</script>

<template>
  <dl class="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs">
    <template v-for="(row, i) in rows" :key="row.label">
      <dt :class="['text-muted', i === rows.length - 1 ? 'mt-1 font-medium text-text' : '']">
        {{ row.label }}
      </dt>
      <dd
        :class="[
          'text-right font-mono tabular-nums',
          i === rows.length - 1 ? 'mt-1 font-medium' : ''
        ]"
      >
        {{ row.value }}
      </dd>
    </template>
  </dl>
</template>
