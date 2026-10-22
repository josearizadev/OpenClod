<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ClaudeDirSource, ClaudeScanReport } from '../../../../shared/sessions'

const report = ref<ClaudeScanReport | null>(null)
const error = ref<string | null>(null)
const scanning = ref(false)

const SOURCES: Record<ClaudeDirSource, string> = {
  settings: 'Ajustes',
  env: 'CLAUDE_CONFIG_DIR',
  default: 'Por defecto'
}

const number = new Intl.NumberFormat('es-ES')
const fmt = (value: number): string => number.format(value)

const unknownTypes = computed(() => {
  if (!report.value) return []
  return [
    ...Object.entries(report.value.unknownLineTypes).map(([type, n]) => `línea «${type}» × ${n}`),
    ...Object.entries(report.value.unknownBlockTypes).map(([type, n]) => `bloque «${type}» × ${n}`)
  ]
})

const hasIssues = computed(
  () =>
    !!report.value &&
    (report.value.invalidLines > 0 ||
      unknownTypes.value.length > 0 ||
      report.value.linkIssues.length > 0)
)

async function scan(): Promise<void> {
  scanning.value = true
  error.value = null
  const result = await window.api.claude.scan()
  if (result.ok) report.value = result.data
  else error.value = result.error.message
  scanning.value = false
}

onMounted(scan)
</script>

<template>
  <section aria-labelledby="diag-claude">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id="diag-claude" class="font-serif text-xl">Claude Code</h2>
      <button
        type="button"
        :disabled="scanning"
        class="rounded-item bg-surface px-3 py-1.5 text-sm shadow-float transition-colors duration-150 hover:bg-surface-hover disabled:opacity-40"
        @click="scan"
      >
        Volver a analizar
      </button>
    </div>

    <p v-if="error" class="text-danger" role="status">No se pudo analizar: {{ error }}</p>
    <p v-else-if="!report" class="text-muted" role="status">Analizando…</p>

    <dl
      v-else
      class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 shadow-float"
      :aria-busy="scanning"
    >
      <dt class="text-muted">Carpeta</dt>
      <dd class="font-mono break-all">
        {{ report.dir }}
        <span class="ml-2 font-sans text-sm text-muted">({{ SOURCES[report.source] }})</span>
      </dd>

      <template v-if="!report.ok">
        <dt class="text-muted">Estado</dt>
        <dd class="text-danger" role="status">{{ report.reason }}</dd>
      </template>

      <template v-else>
        <dt class="text-muted">Contenido</dt>
        <dd>
          {{ fmt(report.projects) }} proyectos · {{ fmt(report.sessions) }} sesiones ·
          {{ fmt(report.subagents) }} subagentes · {{ fmt(report.lines) }} líneas
        </dd>

        <dt class="text-muted">Conversaciones</dt>
        <dd>
          <template v-if="report.conversationLinks > 0">
            {{ fmt(report.conversationLinks) }}
            {{
              report.conversationLinks === 1
                ? 'conversación continuada'
                : 'conversaciones continuadas'
            }}
            en otra sesión ({{ fmt(report.continuedSessions) }}
            {{ report.continuedSessions === 1 ? 'reanudación' : 'reanudaciones' }})
          </template>
          <template v-else>Ninguna repartida en varias sesiones</template>
        </dd>

        <dt class="text-muted">Tokens</dt>
        <dd>
          <span class="font-mono">{{ fmt(report.usage.input) }}</span> de entrada ·
          <span class="font-mono">{{ fmt(report.usage.output) }}</span> de salida ·
          <span class="font-mono">{{ fmt(report.usage.cacheCreation) }}</span> escritos en caché ·
          <span class="font-mono">{{ fmt(report.usage.cacheRead) }}</span> leídos de caché
          <span class="block text-sm text-muted">
            {{ fmt(report.usageEvents) }} mensajes, sin contar dos veces los copiados entre sesiones
          </span>
        </dd>

        <dt class="text-muted">Versiones del CLI</dt>
        <dd class="font-mono">
          <template v-if="report.cliVersions.length > 1">
            {{ report.cliVersions[0] }} – {{ report.cliVersions.at(-1) }}
            <span class="font-sans text-sm text-muted">({{ report.cliVersions.length }})</span>
          </template>
          <template v-else>{{ report.cliVersions[0] ?? '—' }}</template>
        </dd>

        <dt class="text-muted">Anomalías</dt>
        <dd role="status">
          <span v-if="!hasIssues">Sin anomalías</span>
          <template v-else>
            <span v-if="report.invalidLines > 0" class="block text-danger">
              {{ fmt(report.invalidLines) }} líneas con JSON inválido
            </span>
            <span v-if="unknownTypes.length > 0" class="block">
              No reconocidos: {{ unknownTypes.join(', ') }}
            </span>
            <span v-if="report.linkIssues.length > 0" class="block">
              Enlaces entre sesiones: {{ fmt(report.unlinkedOverlaps) }} con historial compartido
              sin enlace, {{ fmt(report.brokenLinks) }} rotos
            </span>
            <ul v-if="report.linkIssues.length > 0" class="mt-1 text-sm text-muted">
              <li v-for="issue in report.linkIssues" :key="issue" class="break-all">{{ issue }}</li>
            </ul>
            <ul v-if="report.sessionsWithIssues.length > 0" class="mt-1 text-sm text-muted">
              <li
                v-for="issue in report.sessionsWithIssues"
                :key="issue.file"
                class="font-mono break-all"
              >
                {{ issue.file }} — {{ issue.invalidLines }} inválidas, {{ issue.unknown }} sin
                reconocer
              </li>
            </ul>
          </template>
        </dd>

        <dt class="text-muted">Duración</dt>
        <dd>{{ fmt(report.durationMs) }} ms</dd>
      </template>
    </dl>
  </section>
</template>
