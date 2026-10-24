<script setup lang="ts">
import { t } from '../../i18n'
import { computed } from 'vue'
import type { LimitWindow } from '../../../../shared/usage'
import { formatAgo, formatClock } from '../../lib/usage-format'
import { useUsageStore } from '../../stores/usage'

// Estado de las fuentes de límites.
const usage = useUsageStore()
const SOURCES: Record<LimitWindow['source'], string> = {
  'sdk-usage': t('Consulta de uso de Claude Code'),
  'chat-event': t('Evento de un chat'),
  'session-hit': t('Aviso de límite en una sesión'),
  estimate: t('Estimación local')
}
const STATES = {
  idle: t('Sin consultar'),
  running: t('Consultando…'),
  ok: t('Correcta'),
  unavailable: t('No disponible'),
  error: t('Error')
}
const rows = computed(() =>
  (
    [
      [t('5 horas'), usage.limits.fiveHour],
      [t('Semanal'), usage.limits.weekly]
    ] as const
  ).map(([label, w]) => ({
    label,
    value: w
      ? `${SOURCES[w.source]} · ${formatAgo(w.observedAt)}${w.resetsAt ? ` · ${t('renueva {time}', { time: formatClock(w.resetsAt) })}` : ''}`
      : t('Sin datos')
  }))
)
</script>

<template>
  <section aria-labelledby="diag-usage">
    <h2 id="diag-usage" class="mb-3 font-serif text-xl">{{ t('Uso y límites') }}</h2>
    <dl
      class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 text-sm shadow-float"
    >
      <template v-for="row in rows" :key="row.label">
        <dt class="text-muted">{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </template>
      <dt class="text-muted">{{ t('Consulta de uso') }}</dt>
      <dd>
        {{ STATES[usage.limits.probe.state] }}
        <template v-if="usage.limits.probe.reason"> · {{ usage.limits.probe.reason }}</template>
        <template v-if="usage.limits.probe.at"> · {{ formatAgo(usage.limits.probe.at) }}</template>
        ·
        <button type="button" class="underline-offset-2 hover:underline" @click="usage.probe(true)">
          {{ t('Consultar ahora') }}
        </button>
      </dd>
      <dt class="text-muted">{{ t('Sonda automática') }}</dt>
      <dd>{{ usage.settings.probe ? t('Activada') : t('Desactivada') }}</dd>
    </dl>
  </section>
</template>
