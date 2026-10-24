<script setup lang="ts">
import { t } from '../../i18n'
import { Clock } from 'lucide-vue-next'
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed } from 'vue'
import { useCountdown } from '../../composables/useCountdown'
import { limitName, limitView } from '../../lib/limits-view'
import { useUsageStore } from '../../stores/usage'

// Medidor de la cabecera.
const usage = useUsageStore()
const five = computed(() => usage.limits.fiveHour)
const now = useCountdown(() => five.value?.resetsAt)
const view = computed(() => limitView(five.value, now.value))
const weekly = computed(() =>
  usage.limits.weekly ? limitView(usage.limits.weekly, now.value, t('Límite semanal')) : null
)
const fillClass = computed(
  () =>
    ({ danger: 'bg-danger', warning: 'bg-warning', normal: 'bg-accent', empty: 'bg-accent' })[
      view.value.tone
    ]
)
const text = computed(() => {
  const v = view.value
  if (v.tone === 'empty') return t('Sin bloque activo')
  if (v.tone === 'danger' && v.remaining) return `${t('Límite')} · ${v.remaining}`
  return [v.value, v.remaining].filter(Boolean).join(' · ')
})
</script>

<template>
  <TooltipRoot :delay-duration="300">
    <TooltipTrigger as-child>
      <RouterLink
        to="/uso"
        class="no-drag mr-2 flex h-8 items-center gap-2 rounded-item px-2 text-xs transition-colors duration-150 hover:bg-surface-hover"
        :class="
          view.tone === 'danger'
            ? 'text-danger'
            : view.tone === 'warning'
              ? 'text-warning'
              : 'text-muted'
        "
        role="meter"
        :aria-valuenow="view.pct ?? undefined"
        :aria-valuemin="view.pct !== null ? 0 : undefined"
        :aria-valuemax="view.pct !== null ? 100 : undefined"
        :aria-label="view.aria"
      >
        <Clock :size="14" :stroke-width="1.75" aria-hidden="true" />
        <span
          class="relative h-1 w-12 overflow-hidden rounded-full bg-meter-track"
          aria-hidden="true"
        >
          <span
            class="absolute inset-y-0 left-0 rounded-full"
            :class="[fillClass, view.estimate ? 'opacity-60' : '']"
            :style="{ width: `${Math.round(view.fill * 100)}%` }"
          />
        </span>
        <span class="tabular-nums whitespace-nowrap">{{ text }}</span>
      </RouterLink>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        side="bottom"
        :side-offset="6"
        :collision-padding="8"
        class="z-30 max-w-72 rounded-menu bg-surface px-3 py-2 text-sm text-text shadow-float"
      >
        <p class="font-medium">{{ five ? limitName(five) : t('Límite de 5 horas') }}</p>
        <p v-if="view.tone === 'empty'" class="text-muted">
          {{ t('Sin mensajes en las últimas 5 horas.') }}
        </p>
        <p v-else>
          {{
            view.pct !== null
              ? t('{pct} % usado', { pct: Math.round(view.pct) })
              : t('{value} tokens en el bloque', { value: view.value })
          }}
          <template v-if="view.resets"> · {{ view.resets }}</template>
        </p>
        <p class="text-xs text-muted">{{ view.source }}</p>
        <p v-if="weekly" class="mt-1">
          {{ t('Semanal') }}: {{ weekly.value || '—'
          }}<template v-if="weekly.resets"> · {{ weekly.resets }}</template>
        </p>
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
