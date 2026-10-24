<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref } from 'vue'
import type { ClaudeDirSource, ClaudeScanReport } from '../../../../shared/sessions'
import { tag } from '../../i18n'

const report = ref<ClaudeScanReport | null>(null)
const error = ref<string | null>(null)
const scanning = ref(false)

const SOURCES: Record<ClaudeDirSource, string> = {
  settings: t('Ajustes'),
  env: 'CLAUDE_CONFIG_DIR',
  default: t('Por defecto')
}

const number = new Intl.NumberFormat(tag)
const fmt = (value: number): string => number.format(value)

const unknownTypes = computed(() => {
  if (!report.value) return []
  return [
    ...Object.entries(report.value.unknownLineTypes).map(([type, n]) =>
      t('línea «{type}» × {n}', { type, n })
    ),
    ...Object.entries(report.value.unknownBlockTypes).map(([type, n]) =>
      t('bloque «{type}» × {n}', { type, n })
    )
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
        {{ t('Volver a analizar') }}
      </button>
    </div>

    <p v-if="error" class="text-danger" role="status">
      {{ t('No se pudo analizar: {error}', { error }) }}
    </p>
    <p v-else-if="!report" class="text-muted" role="status">{{ t('Analizando…') }}</p>

    <dl
      v-else
      class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 shadow-float"
      :aria-busy="scanning"
    >
      <dt class="text-muted">{{ t('Carpeta') }}</dt>
      <dd class="font-mono break-all">
        {{ report.dir }}
        <span class="ml-2 font-sans text-sm text-muted">({{ SOURCES[report.source] }})</span>
      </dd>

      <template v-if="!report.ok">
        <dt class="text-muted">{{ t('Estado') }}</dt>
        <dd class="text-danger" role="status">{{ report.reason }}</dd>
      </template>

      <template v-else>
        <dt class="text-muted">{{ t('Contenido') }}</dt>
        <dd>
          {{
            t(
              '{projects} proyectos · {sessions} sesiones · {subagents} subagentes · {lines} líneas',
              {
                projects: report.projects,
                sessions: report.sessions,
                subagents: report.subagents,
                lines: report.lines
              }
            )
          }}
        </dd>

        <dt class="text-muted">{{ t('Conversaciones') }}</dt>
        <dd>
          <template v-if="report.conversationLinks > 0">
            {{
              t('{conversations} continuadas en otra sesión ({resumes})', {
                conversations:
                  report.conversationLinks === 1
                    ? t('1 conversación')
                    : t('{n} conversaciones', { n: report.conversationLinks }),
                resumes:
                  report.continuedSessions === 1
                    ? t('1 reanudación')
                    : t('{n} reanudaciones', { n: report.continuedSessions })
              })
            }}
          </template>
          <template v-else>{{ t('Ninguna repartida en varias sesiones') }}</template>
        </dd>

        <dt class="text-muted">Tokens</dt>
        <dd>
          {{ t('Entrada') }} <span class="font-mono">{{ fmt(report.usage.input) }}</span> ·
          {{ t('Salida') }} <span class="font-mono">{{ fmt(report.usage.output) }}</span> ·
          {{ t('Creación de caché') }}
          <span class="font-mono">{{ fmt(report.usage.cacheCreation) }}</span> ·
          {{ t('Lectura de caché') }}
          <span class="font-mono">{{ fmt(report.usage.cacheRead) }}</span>
          <span class="block text-sm text-muted">
            {{
              t('{n} mensajes, sin contar dos veces los copiados entre sesiones', {
                n: report.usageEvents
              })
            }}
          </span>
        </dd>

        <dt class="text-muted">{{ t('Versiones del CLI') }}</dt>
        <dd class="font-mono">
          <template v-if="report.cliVersions.length > 1">
            {{ report.cliVersions[0] }} – {{ report.cliVersions.at(-1) }}
            <span class="font-sans text-sm text-muted">({{ report.cliVersions.length }})</span>
          </template>
          <template v-else>{{ report.cliVersions[0] ?? '—' }}</template>
        </dd>

        <dt class="text-muted">{{ t('Anomalías') }}</dt>
        <dd role="status">
          <span v-if="!hasIssues">{{ t('Sin anomalías') }}</span>
          <template v-else>
            <span v-if="report.invalidLines > 0" class="block text-danger">
              {{ t('{n} líneas con JSON inválido', { n: report.invalidLines }) }}
            </span>
            <span v-if="unknownTypes.length > 0" class="block">
              {{ t('No reconocidos: {list}', { list: unknownTypes.join(', ') }) }}
            </span>
            <span v-if="report.linkIssues.length > 0" class="block">
              {{
                t(
                  'Enlaces entre sesiones: {unlinked} con historial compartido sin enlace, {broken} rotos',
                  { unlinked: report.unlinkedOverlaps, broken: report.brokenLinks }
                )
              }}
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
                {{ issue.file }} —
                {{
                  t('{invalid} inválidas, {unknown} sin reconocer', {
                    invalid: issue.invalidLines,
                    unknown: issue.unknown
                  })
                }}
              </li>
            </ul>
          </template>
        </dd>

        <dt class="text-muted">{{ t('Duración') }}</dt>
        <dd>{{ fmt(report.durationMs) }} ms</dd>
      </template>
    </dl>
  </section>
</template>
