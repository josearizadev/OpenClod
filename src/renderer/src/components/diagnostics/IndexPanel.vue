<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref, watch } from 'vue'
import type { SessionMetaStats } from '../../../../shared/projects'
import { longDateTime } from '../../lib/dates'
import { formatNumber, totalTokens } from '../../lib/tokens'
import { useSessionsStore } from '../../stores/sessions'

/**
 * Estado del índice local en «Datos locales» y «Reconstruir índice». El estado
 * llega con cada `index:updated`, así que «en curso» se ve en vivo.
 */
const sessions = useSessionsStore()
const status = computed(() => sessions.status)
const rebuilding = ref(false)
const error = ref<string | null>(null)

/** Datos propios en `state.json`: se cuentan aparte de las ocultas por el índice. */
const meta = ref<SessionMetaStats | null>(null)
async function loadMeta(): Promise<void> {
  const result = await window.api.sessions.metaStats()
  if (result.ok) meta.value = result.data
}

onMounted(() => {
  void sessions.loadStatus()
  void loadMeta()
})
// Tras una pasada o un cambio en la lista, las huérfanas pueden cambiar.
watch(
  () => sessions.items,
  () => void loadMeta()
)

const metaText = computed(() => {
  const m = meta.value
  if (!m) return '…'
  if (m.entries === 0) return t('Ninguno')
  const sessionsText = m.entries === 1 ? t('1 sesión') : t('{n} sesiones', { n: m.entries })
  const orphaned = m.orphaned > 0 ? `; ${t('{n} sin sesión en el índice', { n: m.orphaned })}` : ''
  const favorites = m.favorites === 1 ? t('1 favorita') : t('{n} favoritas', { n: m.favorites })
  const hidden = m.hidden === 1 ? t('1 archivada') : t('{n} archivadas', { n: m.hidden })
  return `${sessionsText} (${favorites}, ${hidden})${orphaned}`
})

const running = computed(() => status.value?.running ?? false)

const lastPass = computed(() => {
  const pass = status.value?.lastPass
  if (!pass) return t('Ninguna todavía')
  const files =
    pass.filesRead === 1 ? t('1 archivo leído') : t('{n} archivos leídos', { n: pass.filesRead })
  return `${longDateTime(pass.finishedAt)} · ${formatNumber(pass.durationMs)} ms · ${files}`
})

/** Línea de vigilancia. */
const watchText = computed(() => {
  const w = status.value?.watch
  if (!w) return '…'
  if (w.state === 'watching') {
    return w.lastEventAt
      ? t('Activa · último cambio {date}', { date: longDateTime(w.lastEventAt) })
      : t('Activa · sin cambios desde que arrancó')
  }
  const reason = w.reason ? ` (${w.reason})` : ''
  return w.state === 'polling'
    ? `${t('Sin vigilancia')}${reason} · ${t('se comprueba cada 30 s con la ventana activa')}`
    : `${t('Sin vigilancia')}${reason} · ${t('«Actualizar» lo reintenta')}`
})

async function rebuild(): Promise<void> {
  rebuilding.value = true
  error.value = null
  const result = await window.api.index.rebuild()
  if (!result.ok) error.value = result.error.message
  rebuilding.value = false
  await sessions.loadStatus()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="font-medium">{{ t('Índice') }}</h3>
      <button
        type="button"
        :disabled="rebuilding || running || status?.ok === false"
        class="rounded-item bg-surface px-3 py-1.5 text-sm shadow-float transition-colors duration-150 hover:bg-surface-hover disabled:opacity-40"
        @click="rebuild"
      >
        {{ t('Reconstruir índice') }}
      </button>
    </div>

    <p v-if="!status" class="text-muted" role="status">…</p>
    <dl
      v-else
      class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 shadow-float"
      :aria-busy="running"
    >
      <dt class="text-muted">{{ t('Estado') }}</dt>
      <dd role="status">
        <span v-if="!status.ok" class="text-danger">
          {{
            t('Error: {error} (los proyectos funcionan, pero sin lista de sesiones)', {
              error: status.error ?? ''
            })
          }}
        </span>
        <span v-else-if="running">{{ t('Indexando…') }}</span>
        <span v-else>SQLite {{ status.sqliteVersion }} · {{ t('al día') }}</span>
      </dd>
      <dt class="text-muted">{{ t('Archivo') }}</dt>
      <dd class="font-mono break-all">{{ status.path }}</dd>
      <template v-if="status.ok">
        <dt class="text-muted">{{ t('Esquema') }}</dt>
        <dd>{{ t('Versión {version}', { version: String(status.schemaVersion) }) }}</dd>
        <dt class="text-muted">{{ t('Contenido') }}</dt>
        <dd>
          {{
            t('{files} archivos · {sessions} sesiones · {events} eventos de uso', {
              files: status.files,
              sessions: status.sessions,
              events: status.usageEvents
            })
          }}
        </dd>
        <dt class="text-muted">{{ t('Ocultas') }}</dt>
        <dd>
          {{ formatNumber(status.hiddenSessions) }}
          <span class="text-sm text-muted">({{ t('sin prompts ni respuestas') }})</span>
        </dd>
        <dt class="text-muted">{{ t('Datos propios') }}</dt>
        <dd>
          {{ metaText }}
          <span class="text-sm text-muted"
            >({{ t('títulos, favoritas y archivadas en state.json') }})</span
          >
        </dd>
        <dt class="text-muted">Tokens</dt>
        <dd>
          {{ formatNumber(totalTokens(status.usage)) }}
          <span class="text-sm text-muted">
            ({{ t('Entrada') }} {{ formatNumber(status.usage.input) }} · {{ t('Salida') }}
            {{ formatNumber(status.usage.output) }} · {{ t('Creación de caché') }}
            {{ formatNumber(status.usage.cacheCreation) }} · {{ t('Lectura de caché') }}
            {{ formatNumber(status.usage.cacheRead) }})
          </span>
        </dd>
        <dt class="text-muted">{{ t('Última pasada') }}</dt>
        <dd>{{ lastPass }}</dd>
        <dt class="text-muted">{{ t('Vigilancia') }}</dt>
        <dd>{{ watchText }}</dd>
        <dt class="text-muted">{{ t('Búsqueda') }}</dt>
        <dd>
          {{ t('{n} mensajes indexados', { n: status.search?.messages ?? 0 }) }}
          <span v-if="status.progress" class="text-sm text-muted">
            ({{
              t('indexando {done} de {total} sesiones…', {
                done: status.progress.done,
                total: status.progress.total
              })
            }})
          </span>
        </dd>
      </template>
    </dl>
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
  </div>
</template>
