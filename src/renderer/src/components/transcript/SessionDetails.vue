<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CostTotal } from '../../../../shared/usage'
import { formatUsd } from '../../lib/usage-format'
import { useUsageStore } from '../../stores/usage'
import type { SessionDetail } from '../../../../shared/projects'
import { longDateTime } from '../../lib/dates'
import { formatNumber } from '../../lib/tokens'
import SessionChip from '../chat/SessionChip.vue'
import TokenBreakdown from '../sessions/TokenBreakdown.vue'

/** Ficha de la sesión, sin el título: va en «Detalles». */
const props = defineProps<{
  detail: SessionDetail
  /** Líneas inválidas del transcript (si se ha cargado). */
  invalidLines?: number
}>()

// Coste equivalente de la conversación si el ajuste está activo.
const usage = useUsageStore()
const cost = ref<CostTotal | null>(null)
watch(
  () => [props.detail.sessionId, props.detail.updatedAt, usage.settings.showCost] as const,
  async ([id, , show]) => {
    cost.value = null
    if (!show) return
    const result = await window.api.usage.sessionCost(id)
    if (result.ok && id === props.detail.sessionId) cost.value = result.data
  },
  { immediate: true }
)

const facts = computed(() => {
  const d = props.detail
  return [
    { label: 'Inicio', value: longDateTime(d.startedAt) },
    { label: 'Última actividad', value: longDateTime(d.updatedAt) },
    { label: 'Rama', value: d.gitBranch ?? '—', mono: true },
    { label: 'Carpeta', value: d.cwd ?? '—', mono: true },
    { label: d.models.length === 1 ? 'Modelo' : 'Modelos', value: d.models.join(', ') || '—' },
    { label: 'Mensajes', value: formatNumber(d.messageCount) },
    { label: 'Llamadas a herramientas', value: formatNumber(d.toolCallCount) },
    { label: 'Subagentes', value: formatNumber(d.subagentCount) },
    ...(cost.value
      ? [
          {
            label: 'Coste equivalente',
            value: `${cost.value.partial ? '≥ ' : ''}${formatUsd(cost.value.usd)} según Claude Code`
          }
        ]
      : []),
    ...(props.invalidLines
      ? [{ label: 'Líneas no válidas', value: formatNumber(props.invalidLines) }]
      : [])
  ]
})
</script>

<template>
  <div class="flex flex-col gap-4 text-sm">
    <div class="-ml-2">
      <SessionChip :session-id="detail.sessionId" />
    </div>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5">
      <template v-for="fact in facts" :key="fact.label">
        <dt class="text-muted">{{ fact.label }}</dt>
        <dd :class="['break-words', fact.mono ? 'font-mono text-[13px]' : '']">
          {{ fact.value }}
        </dd>
      </template>
    </dl>
    <div class="flex flex-wrap gap-6">
      <div>
        <p class="mb-2 font-medium">
          {{ detail.chainLength > 1 ? `Conversación de ${detail.chainLength} sesiones` : 'Tokens' }}
        </p>
        <TokenBreakdown :usage="detail.usage" />
      </div>
      <div v-if="detail.chainLength > 1">
        <p class="mb-2 font-medium">Solo esta sesión</p>
        <TokenBreakdown :usage="detail.ownUsage" />
      </div>
    </div>
  </div>
</template>
