<script setup lang="ts">
import { t } from '../i18n'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  ToggleGroupItem,
  ToggleGroupRoot
} from 'reka-ui'
import { Check, Ellipsis } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { UsagePeriod, UsageScope } from '../../../shared/usage'
import BlockList from '../components/usage/BlockList.vue'
import DailyChart from '../components/usage/DailyChart.vue'
import LimitCard from '../components/usage/LimitCard.vue'
import UsageBreakdown from '../components/usage/UsageBreakdown.vue'
import TokenBreakdown from '../components/sessions/TokenBreakdown.vue'
import { limitName } from '../lib/limits-view'
import { formatClock, formatInteger, formatTokens, formatUsd } from '../lib/usage-format'
import { useProjectsStore } from '../stores/projects'
import { useUsageStore } from '../stores/usage'

// Vista Uso: límites, bloque actual, totales, gráfica, desgloses y bloques.
const usage = useUsageStore()
const projects = useProjectsStore()

onMounted(() => {
  usage.viewers += 1
  void usage.load()
  void usage.probe()
})
onBeforeUnmount(() => (usage.viewers -= 1))

const periodModel = computed({
  get: () => usage.settings.period,
  set: (v: UsagePeriod | undefined) => v && usage.setPeriod(v)
})
const scopeModel = computed({
  get: () => usage.scope,
  set: (v: UsageScope | undefined) => v && usage.setScope(v)
})

const report = computed(() => usage.report)
const current = computed(() => report.value?.current ?? null)
const models = computed(() => report.value?.byModel.map((m) => m.model) ?? [])
const probe = computed(() => usage.limits.probe)

const segmented =
  'h-7 rounded-item px-2.5 text-sm text-muted transition-colors duration-150 hover:text-text data-[state=on]:bg-surface-hover data-[state=on]:text-text disabled:opacity-40'
const menuItem =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 text-sm outline-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-4 pb-12">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ToggleGroupRoot
        v-model="periodModel"
        type="single"
        :aria-label="t('Periodo')"
        class="flex gap-0.5"
      >
        <ToggleGroupItem value="today" :class="segmented">{{ t('Hoy') }}</ToggleGroupItem>
        <ToggleGroupItem value="7d" :class="segmented">{{ t('7 días') }}</ToggleGroupItem>
        <ToggleGroupItem value="30d" :class="segmented">{{ t('30 días') }}</ToggleGroupItem>
        <ToggleGroupItem value="all" :class="segmented">{{ t('Todo') }}</ToggleGroupItem>
      </ToggleGroupRoot>
      <ToggleGroupRoot
        v-model="scopeModel"
        type="single"
        :aria-label="t('Ámbito')"
        class="flex gap-0.5"
      >
        <ToggleGroupItem value="project" :disabled="!projects.activeId" :class="segmented">
          {{ t('Este proyecto') }}
        </ToggleGroupItem>
        <ToggleGroupItem value="all" :class="segmented">{{ t('Todos') }}</ToggleGroupItem>
      </ToggleGroupRoot>
      <DropdownMenuRoot>
        <DropdownMenuTrigger
          class="ml-auto inline-flex size-8 items-center justify-center rounded-item text-muted hover:bg-surface-hover hover:text-text"
          :aria-label="t('Opciones de uso')"
        >
          <Ellipsis :size="18" :stroke-width="1.75" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            :side-offset="4"
            class="z-30 min-w-64 rounded-menu bg-surface p-1 text-text shadow-float"
          >
            <DropdownMenuCheckboxItem
              :model-value="usage.settings.showCost"
              :class="menuItem"
              @update:model-value="(v: boolean) => usage.update({ showCost: v })"
            >
              <Check :size="14" :class="usage.settings.showCost ? '' : 'invisible'" />
              {{ t('Mostrar coste equivalente') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              :model-value="usage.settings.probe"
              :class="menuItem"
              @update:model-value="(v: boolean) => usage.update({ probe: v })"
            >
              <Check :size="14" :class="usage.settings.probe ? '' : 'invisible'" />
              {{ t('Consultar los límites a Claude Code') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem :class="menuItem" @select="usage.probe(true)">
              <span class="w-3.5" />{{ t('Consultar ahora') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </header>

    <!-- Límites. -->
    <section :aria-label="t('Límites')" class="flex flex-col gap-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <LimitCard
          :title="t('Límite de 5 horas')"
          :window="usage.limits.fiveHour"
          :empty="t('Sin bloque activo')"
        />
        <LimitCard
          :title="t('Límite semanal')"
          :window="usage.limits.weekly"
          :empty="t('Solo lo sabe Claude Code: abre un chat o pulsa «Consultar ahora»')"
        />
        <LimitCard
          v-for="w in usage.limits.perModel"
          :key="`${w.kind}:${w.label ?? ''}`"
          :title="limitName(w)"
          :window="w"
        />
      </div>
      <p class="text-xs text-muted">
        <template v-if="usage.limits.subscription"
          >{{ t('Plan {plan}', { plan: usage.limits.subscription }) }} ·
        </template>
        <template v-if="probe.state === 'running'">{{ t('Consultando a Claude Code…') }}</template>
        <template v-else-if="probe.state === 'unavailable' || probe.state === 'error'">
          <span class="text-danger">{{ probe.reason }}</span> ·
          <button
            type="button"
            class="underline-offset-2 hover:underline"
            @click="usage.probe(true)"
          >
            {{ t('Reintentar') }}
          </button>
        </template>
        <template v-else-if="!usage.settings.probe">
          {{
            t(
              'Consulta a Claude Code desactivada: los límites reales llegan con los chats abiertos.'
            )
          }}
        </template>
        {{
          t(
            'La estimación local agrupa tus mensajes en bloques de 5 h; el límite real depende del plan y no se conoce en local.'
          )
        }}
      </p>
    </section>

    <p v-if="usage.error" class="text-sm text-danger" role="alert">{{ usage.error }}</p>
    <p v-else-if="usage.loading" class="text-sm text-muted">{{ t('Calculando…') }}</p>

    <template v-if="report">
      <!-- Bloque actual. -->
      <section aria-labelledby="usage-current" class="flex flex-col gap-1">
        <h3 id="usage-current" class="text-sm font-medium">
          {{ t('Bloque actual · estimación local') }}
        </h3>
        <template v-if="current?.block">
          <p class="text-sm">
            {{ formatClock(current.block.start) }} – {{ formatClock(current.block.end) }} ·
            {{ t('{n} tokens', { n: formatTokens(current.block.tokens) }) }} ·
            {{ t('{n} mensajes', { n: formatInteger(current.block.messages) }) }} ·
            {{ current.block.models.join(', ') }}
          </p>
          <p class="text-sm text-muted">
            {{ t('Ritmo ~{rate} tokens/min', { rate: formatTokens(current.ratePerMin) }) }}
            <template v-if="current.projected !== null">
              · {{ t('al final del bloque ~{n}', { n: formatTokens(current.projected) }) }}
            </template>
            <template v-if="current.referenceMax">
              ·
              {{
                t('{pct} % respecto a tu bloque más grande (30 días)', {
                  pct: Math.round((current.block.tokens / current.referenceMax) * 100)
                })
              }}
            </template>
          </p>
        </template>
        <p v-else class="text-sm text-muted">{{ t('Sin bloque activo.') }}</p>
      </section>

      <!-- Totales. -->
      <section aria-labelledby="usage-totals" class="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <h3 id="usage-totals" class="text-sm text-muted">{{ t('Tokens del periodo') }}</h3>
          <p class="text-4xl tabular-nums">{{ formatTokens(report.totals.tokens) }}</p>
          <p class="text-sm text-muted">
            {{ t('{n} mensajes', { n: formatInteger(report.totals.messages) }) }} ·
            {{ t('{n} sesiones', { n: formatInteger(report.totals.sessions) }) }}
          </p>
          <p v-if="report.cost" class="mt-1 text-sm">
            <template v-if="report.cost.partial">≥ </template>{{ formatUsd(report.cost.usd) }}
            <span class="text-xs text-muted">
              {{ t('coste equivalente de API según Claude Code') }}
              <template v-if="report.cost.missingSessions">
                · {{ t('{n} sesiones sin coste', { n: report.cost.missingSessions }) }}
              </template>
            </span>
          </p>
        </div>
        <TokenBreakdown :usage="report.totals.usage" />
      </section>

      <DailyChart :days="report.daily" :models="models" />
      <UsageBreakdown :report="report" :show-cost="usage.settings.showCost" />
      <BlockList :blocks="report.blocks" />
      <p class="text-xs text-muted">
        {{ t('Los bloques son de toda la cuenta, aunque el ámbito sea un proyecto') }} ·
        {{ report.tookMs }} ms
      </p>
    </template>
  </div>
</template>
