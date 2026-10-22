<script setup lang="ts">
import { computed } from 'vue'
import type { LimitWindow } from '../../../../shared/usage'
import { formatAgo, formatClock } from '../../lib/usage-format'
import { useUsageStore } from '../../stores/usage'

// Estado de las fuentes de límites.
const usage = useUsageStore()
const SOURCES: Record<LimitWindow['source'], string> = {
  'sdk-usage': 'Consulta de uso de Claude Code',
  'chat-event': 'Evento de un chat',
  'session-hit': 'Aviso de límite en una sesión',
  estimate: 'Estimación local'
}
const STATES = {
  idle: 'Sin consultar',
  running: 'Consultando…',
  ok: 'Correcta',
  unavailable: 'No disponible',
  error: 'Error'
}
const rows = computed(() =>
  (
    [
      ['5 horas', usage.limits.fiveHour],
      ['Semanal', usage.limits.weekly]
    ] as const
  ).map(([label, w]) => ({
    label,
    value: w
      ? `${SOURCES[w.source]} · ${formatAgo(w.observedAt)}${w.resetsAt ? ` · renueva ${formatClock(w.resetsAt)}` : ''}`
      : 'Sin datos'
  }))
)
</script>

<template>
  <section aria-labelledby="diag-usage">
    <h2 id="diag-usage" class="mb-3 font-serif text-xl">Uso y límites</h2>
    <dl
      class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 text-sm shadow-float"
    >
      <template v-for="row in rows" :key="row.label">
        <dt class="text-muted">{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </template>
      <dt class="text-muted">Consulta de uso</dt>
      <dd>
        {{ STATES[usage.limits.probe.state] }}
        <template v-if="usage.limits.probe.reason"> · {{ usage.limits.probe.reason }}</template>
        <template v-if="usage.limits.probe.at"> · {{ formatAgo(usage.limits.probe.at) }}</template>
        ·
        <button type="button" class="underline-offset-2 hover:underline" @click="usage.probe(true)">
          Consultar ahora
        </button>
      </dd>
      <dt class="text-muted">Sonda automática</dt>
      <dd>{{ usage.settings.probe ? 'Activada' : 'Desactivada' }}</dd>
    </dl>
  </section>
</template>
