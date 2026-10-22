<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UsageDay } from '../../../../shared/usage'
import { formatDay, formatInteger, formatTokens } from '../../lib/usage-format'

/**
 * Tokens por día apilados por modelo. SVG propio: 4 series validadas
 * (`--chart-1..4`) en orden fijo por volumen total, el resto en «Otros»; leyenda siempre, foco con
 * ←/→, tooltip y tabla equivalente.
 */
const props = defineProps<{ days: UsageDay[]; models: string[] }>()

const SLOTS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const OTHER = 'Otros'
const series = computed(() => {
  const list = props.models
    .slice(0, 4)
    .map((model, i) => ({ key: model, label: shortModel(model), color: SLOTS[i] as string }))
  if (props.models.length > 4) list.push({ key: OTHER, label: OTHER, color: 'var(--chart-other)' })
  return list
})

function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

function valueOf(day: UsageDay, key: string): number {
  if (key !== OTHER) return day.byModel[key] ?? 0
  const top = new Set(props.models.slice(0, 4))
  return Object.entries(day.byModel).reduce((sum, [m, v]) => (top.has(m) ? sum : sum + v), 0)
}

const W = 720
const H = 180
const BASE = H - 20
const max = computed(() => Math.max(1, ...props.days.map((d) => d.total)))
const slot = computed(() => W / Math.max(1, props.days.length))
const barWidth = computed(() => Math.max(2, Math.min(28, slot.value - 4)))
const labelEvery = computed(() => Math.ceil(props.days.length / 10))

const bars = computed(() =>
  props.days.map((day, i) => {
    let y = BASE
    const scale = (BASE - 8) / max.value
    const segments = series.value.flatMap((s) => {
      const v = valueOf(day, s.key)
      if (v <= 0) return []
      const h = Math.max(1, v * scale)
      y -= h
      // 2 px de separación entre segmentos.
      return [{ key: s.key, color: s.color, y: y + 1, h: Math.max(1, h - 2) }]
    })
    return { day, i, x: i * slot.value + (slot.value - barWidth.value) / 2, segments }
  })
)

const focused = ref<number | null>(null)
const hovered = ref<number | null>(null)
const active = computed(() => hovered.value ?? focused.value)
const activeDay = computed(() => (active.value !== null ? props.days[active.value] : undefined))
const showTable = ref(false)

function onKey(event: KeyboardEvent): void {
  const n = props.days.length
  if (!n) return
  if (event.key === 'ArrowRight') focused.value = Math.min(n - 1, (focused.value ?? -1) + 1)
  else if (event.key === 'ArrowLeft') focused.value = Math.max(0, (focused.value ?? n) - 1)
  else return
  event.preventDefault()
}
</script>

<template>
  <section aria-labelledby="usage-daily">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 id="usage-daily" class="text-sm font-medium">Tokens por día</h3>
      <button
        type="button"
        class="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
        @click="showTable = !showTable"
      >
        {{ showTable ? 'Ver como gráfica' : 'Ver como tabla' }}
      </button>
    </div>
    <ul class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Leyenda">
      <li v-for="s in series" :key="s.key" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm" :style="{ background: s.color }" aria-hidden="true" />
        {{ s.label }}
      </li>
    </ul>
    <div v-if="!showTable" class="relative">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="h-48 w-full overflow-visible"
        role="img"
        tabindex="0"
        aria-label="Gráfica de tokens por día; usa las flechas para recorrer los días"
        preserveAspectRatio="none"
        @keydown="onKey"
        @blur="focused = null"
        @mouseleave="hovered = null"
      >
        <line x1="0" :x2="W" :y1="BASE" :y2="BASE" stroke="var(--border)" />
        <g v-for="bar in bars" :key="bar.day.day" @mouseenter="hovered = bar.i">
          <rect :x="bar.i * slot" y="0" :width="slot" :height="H" fill="transparent" />
          <rect
            v-for="seg in bar.segments"
            :key="seg.key"
            :x="bar.x"
            :y="seg.y"
            :width="barWidth"
            :height="seg.h"
            :fill="seg.color"
            rx="2"
            :opacity="active === null || active === bar.i ? 1 : 0.45"
          />
          <text
            v-if="bar.i % labelEvery === 0"
            :x="bar.i * slot + slot / 2"
            :y="H - 4"
            text-anchor="middle"
            fill="var(--text-muted)"
            font-size="10"
          >
            {{ formatDay(bar.day.day) }}
          </text>
        </g>
      </svg>
      <div
        v-if="activeDay && active !== null"
        class="pointer-events-none absolute top-0 z-10 w-48 rounded-menu bg-surface px-3 py-2 text-xs shadow-float"
        :style="{
          left: `min(calc(${((active + 0.5) / days.length) * 100}% + 8px), calc(100% - 12rem))`
        }"
        role="status"
      >
        <p class="font-medium">
          {{ formatDay(activeDay.day) }} · {{ formatTokens(activeDay.total) }}
        </p>
        <p v-for="s in series" :key="s.key" class="flex items-center gap-1.5 text-muted">
          <span class="size-2 rounded-sm" :style="{ background: s.color }" aria-hidden="true" />
          {{ s.label }}:
          <span class="text-text tabular-nums">{{ formatInteger(valueOf(activeDay, s.key)) }}</span>
        </p>
      </div>
    </div>
    <table :class="showTable ? 'w-full text-xs' : 'sr-only'">
      <caption class="sr-only">
        Tokens por día y modelo
      </caption>
      <thead>
        <tr class="text-left text-muted">
          <th class="py-1 font-normal">Día</th>
          <th v-for="s in series" :key="s.key" class="py-1 text-right font-normal">
            {{ s.label }}
          </th>
          <th class="py-1 text-right font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in days" :key="d.day" class="border-t border-border">
          <td class="py-1">{{ formatDay(d.day) }}</td>
          <td v-for="s in series" :key="s.key" class="py-1 text-right tabular-nums">
            {{ formatInteger(valueOf(d, s.key)) }}
          </td>
          <td class="py-1 text-right tabular-nums">{{ formatInteger(d.total) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
