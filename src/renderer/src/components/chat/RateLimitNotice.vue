<script setup lang="ts">
import { t } from '../../i18n'
import { Clock } from 'lucide-vue-next'
import { computed } from 'vue'
import type { LimitWindow } from '../../../../shared/usage'
import { useCountdown } from '../../composables/useCountdown'
import { formatClock, formatDuration } from '../../lib/usage-format'

/**
 * Aviso de límite en el chat: rechazo con la hora de renovación y cuenta atrás, o
 * aviso discreto al acercarse. Desaparece al renovarse.
 */
const props = defineProps<{ window: LimitWindow }>()
const now = useCountdown(() => props.window.resetsAt)
const left = computed(() =>
  props.window.resetsAt ? Date.parse(props.window.resetsAt) - now.value : null
)
const rejected = computed(() => props.window.status === 'rejected')
const visible = computed(() => left.value === null || left.value > 0)
const text = computed(() => {
  const resets = props.window.resetsAt
    ? ` · ${t('se renueva a las {time}', { time: formatClock(props.window.resetsAt, now.value) })}` +
      (left.value !== null
        ? ` (${t('dentro de {time}', { time: formatDuration(left.value) })})`
        : '')
    : ''
  if (rejected.value) return `${t('Has alcanzado el límite de uso')}${resets}`
  const pct = props.window.utilization
  return `${t('Te acercas al límite de uso')}${pct !== null ? ` (${Math.round(pct)} %)` : ''}${resets}`
})
</script>

<template>
  <div
    v-if="visible"
    class="flex items-start gap-2 rounded-item border bg-surface px-3 py-2 text-sm"
    :class="rejected ? 'border-danger/40' : 'border-warning/40'"
    :role="rejected ? 'alert' : 'status'"
  >
    <Clock
      class="mt-0.5 shrink-0"
      :class="rejected ? 'text-danger' : 'text-warning'"
      :size="16"
      :stroke-width="1.75"
      aria-hidden="true"
    />
    <p class="min-w-0 flex-1">{{ text }}</p>
  </div>
</template>
