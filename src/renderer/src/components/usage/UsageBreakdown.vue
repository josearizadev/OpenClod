<script setup lang="ts">
import type { UsageReport } from '../../../../shared/usage'
import { formatInteger, formatTokens, formatUsd } from '../../lib/usage-format'

// Desgloses por proyecto, modelo y conversación.
defineProps<{ report: UsageReport; showCost: boolean }>()
</script>

<template>
  <div class="grid gap-6 md:grid-cols-2">
    <section aria-labelledby="usage-projects">
      <h3 id="usage-projects" class="mb-2 text-sm font-medium">Por proyecto</h3>
      <table class="w-full table-fixed text-sm">
        <tbody>
          <tr v-for="p in report.byProject" :key="p.key" class="border-t border-border">
            <td
              class="truncate py-1.5"
              :class="p.imported ? '' : 'text-muted'"
              :title="p.imported ? p.name : `${p.name} (no importado)`"
            >
              {{ p.name }}
            </td>
            <td class="w-20 py-1.5 text-right tabular-nums">{{ formatTokens(p.tokens) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <section aria-labelledby="usage-models">
      <h3 id="usage-models" class="mb-2 text-sm font-medium">Por modelo</h3>
      <table class="w-full text-sm">
        <tbody>
          <tr v-for="m in report.byModel" :key="m.model" class="border-t border-border">
            <td class="py-1.5 font-mono text-xs">{{ m.model }}</td>
            <td class="py-1.5 text-right text-xs text-muted tabular-nums">
              {{ formatInteger(m.messages) }} mens.
            </td>
            <td class="py-1.5 text-right tabular-nums">{{ formatTokens(m.tokens) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <section class="md:col-span-2" aria-labelledby="usage-sessions">
      <h3 id="usage-sessions" class="mb-2 text-sm font-medium">Sesiones con más uso</h3>
      <ol class="text-sm">
        <li v-for="s in report.topSessions" :key="s.sessionId" class="border-t border-border">
          <RouterLink
            :to="{ name: 'session', params: { id: s.sessionId } }"
            class="flex items-center gap-3 rounded-item px-1 py-1.5 transition-colors duration-150 hover:bg-surface-hover"
          >
            <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
            <span class="shrink-0 text-xs text-muted">{{ s.projectName }}</span>
            <span v-if="showCost && s.cost" class="shrink-0 text-xs text-muted tabular-nums">
              {{ formatUsd(s.cost.usd) }}
            </span>
            <span class="w-16 shrink-0 text-right tabular-nums">{{ formatTokens(s.tokens) }}</span>
          </RouterLink>
        </li>
      </ol>
    </section>
  </div>
</template>
