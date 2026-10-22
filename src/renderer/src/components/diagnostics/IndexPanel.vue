<script setup lang="ts">
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
  if (m.entries === 0) return 'Ninguno'
  const sessionsText = m.entries === 1 ? '1 sesión' : `${formatNumber(m.entries)} sesiones`
  const orphaned = m.orphaned > 0 ? `; ${formatNumber(m.orphaned)} sin sesión en el índice` : ''
  const favorites = m.favorites === 1 ? '1 favorita' : `${formatNumber(m.favorites)} favoritas`
  const hidden = m.hidden === 1 ? '1 oculta' : `${formatNumber(m.hidden)} ocultas`
  return `${sessionsText} (${favorites}, ${hidden})${orphaned}`
})

const running = computed(() => status.value?.running ?? false)

const lastPass = computed(() => {
  const pass = status.value?.lastPass
  if (!pass) return 'Ninguna todavía'
  const files =
    pass.filesRead === 1 ? '1 archivo leído' : `${formatNumber(pass.filesRead)} archivos leídos`
  return `${longDateTime(pass.finishedAt)} · ${formatNumber(pass.durationMs)} ms · ${files}`
})

/** Línea de vigilancia. */
const watchText = computed(() => {
  const w = status.value?.watch
  if (!w) return '…'
  if (w.state === 'watching') {
    return w.lastEventAt
      ? `Activa · último cambio ${longDateTime(w.lastEventAt)}`
      : 'Activa · sin cambios desde que arrancó'
  }
  const reason = w.reason ? ` (${w.reason})` : ''
  return w.state === 'polling'
    ? `Sin vigilancia${reason} · se comprueba cada 30 s con la ventana activa`
    : `Sin vigilancia${reason} · «Actualizar» lo reintenta`
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
      <h3 class="font-medium">Índice</h3>
      <button
        type="button"
        :disabled="rebuilding || running || status?.ok === false"
        class="rounded-item bg-surface px-3 py-1.5 text-sm shadow-float transition-colors duration-150 hover:bg-surface-hover disabled:opacity-40"
        @click="rebuild"
      >
        Reconstruir índice
      </button>
    </div>

    <p v-if="!status" class="text-muted" role="status">…</p>
    <dl
      v-else
      class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 shadow-float"
      :aria-busy="running"
    >
      <dt class="text-muted">Estado</dt>
      <dd role="status">
        <span v-if="!status.ok" class="text-danger">
          Error: {{ status.error }} (los proyectos funcionan, pero sin lista de sesiones)
        </span>
        <span v-else-if="running">Indexando…</span>
        <span v-else>SQLite {{ status.sqliteVersion }} · al día</span>
      </dd>
      <dt class="text-muted">Archivo</dt>
      <dd class="font-mono break-all">{{ status.path }}</dd>
      <template v-if="status.ok">
        <dt class="text-muted">Esquema</dt>
        <dd>Versión {{ status.schemaVersion }}</dd>
        <dt class="text-muted">Contenido</dt>
        <dd>
          {{ formatNumber(status.files) }} archivos · {{ formatNumber(status.sessions) }} sesiones ·
          {{ formatNumber(status.usageEvents) }} eventos de uso
        </dd>
        <dt class="text-muted">Ocultas</dt>
        <dd>
          {{ formatNumber(status.hiddenSessions) }}
          <span class="text-sm text-muted">(sin prompts ni respuestas)</span>
        </dd>
        <dt class="text-muted">Datos propios</dt>
        <dd>
          {{ metaText }}
          <span class="text-sm text-muted">(títulos, favoritas y ocultas en state.json)</span>
        </dd>
        <dt class="text-muted">Tokens</dt>
        <dd>
          {{ formatNumber(totalTokens(status.usage)) }}
          <span class="text-sm text-muted">
            (entrada {{ formatNumber(status.usage.input) }} · salida
            {{ formatNumber(status.usage.output) }} · creación de caché
            {{ formatNumber(status.usage.cacheCreation) }} · lectura de caché
            {{ formatNumber(status.usage.cacheRead) }})
          </span>
        </dd>
        <dt class="text-muted">Última pasada</dt>
        <dd>{{ lastPass }}</dd>
        <dt class="text-muted">Vigilancia</dt>
        <dd>{{ watchText }}</dd>
        <dt class="text-muted">Búsqueda</dt>
        <dd>
          {{ formatNumber(status.search?.messages ?? 0) }} mensajes indexados
          <span v-if="status.progress" class="text-sm text-muted">
            (indexando {{ formatNumber(status.progress.done) }} de
            {{ formatNumber(status.progress.total) }} sesiones…)
          </span>
        </dd>
      </template>
    </dl>
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
  </div>
</template>
