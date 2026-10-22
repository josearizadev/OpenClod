<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { groupSessions, hiddenCount } from '../../lib/sessions-groups'
import { useSessionsStore } from '../../stores/sessions'
import SessionListItem from './SessionListItem.vue'
import SessionSelectionBar from './SessionSelectionBar.vue'

/**
 * Sesiones del proyecto activo: «Favoritas» y grupos por fecha, con «Actualizar»,
 * «Mostrar ocultas (N)» y los estados de carga, vacío y error del índice.
 */
const sessions = useSessionsStore()

// La hora de referencia se renueva cada minuto para que «hace 5 min» no se quede viejo.
const now = ref(new Date())
const timer = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(timer))

const groups = computed(() => groupSessions(sessions.items, now.value, sessions.showHidden))
/** Entradas en el orden en que se ven: rango de `Mayús+clic` y «Seleccionar todo». */
const order = computed(() => groups.value.flatMap((g) => g.items.map((i) => i.sessionId)))

function onSelect(sessionId: string, range: boolean): void {
  if (range) sessions.selectRange(sessionId, order.value)
  else sessions.toggleSelect(sessionId)
}

// `Esc` vacía la selección y `Supr` pide eliminar, con el foco en la lista o en ninguna
// parte: en el compositor o en un diálogo esas teclas son suyas.
const root = ref<HTMLElement | null>(null)
function onKeydown(event: KeyboardEvent): void {
  if (!sessions.selecting || event.defaultPrevented) return
  const focus = document.activeElement
  if (focus && focus !== document.body && !root.value?.contains(focus)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    sessions.clearSelection()
  } else if (event.key === 'Delete') {
    event.preventDefault()
    sessions.askTrash(sessions.selected)
  }
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
const hidden = computed(() => hiddenCount(sessions.items))
const running = computed(() => sessions.status?.running ?? false)
const indexError = computed(() => sessions.status?.ok === false)
const showSkeleton = computed(
  () => sessions.items.length === 0 && !indexError.value && (!sessions.loaded || running.value)
)
const showEmpty = computed(
  () =>
    sessions.loaded &&
    sessions.items.length === 0 &&
    !running.value &&
    !indexError.value &&
    !sessions.error
)

// Marca de rendimiento: la primera vez que la lista se pinta con datos.
let painted = false
watch(
  () => sessions.items.length,
  async (length) => {
    if (painted || length === 0) return
    painted = true
    await nextTick()
    requestAnimationFrame(() => performance.mark('bitacora:lista-pintada'))
  },
  { immediate: true }
)
</script>

<template>
  <section ref="root" aria-labelledby="sidebar-sessions" class="mt-3">
    <div class="flex items-center justify-between pr-1 pl-2">
      <h2 id="sidebar-sessions" class="text-xs font-medium text-muted">Sesiones</h2>
      <button
        type="button"
        :disabled="sessions.refreshing"
        :aria-label="running ? 'Actualizando sesiones' : 'Actualizar sesiones'"
        :title="running ? 'Actualizando…' : 'Actualizar'"
        class="no-drag inline-flex size-7 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none"
        @click="sessions.refresh()"
      >
        <RefreshCw
          :size="14"
          :stroke-width="1.75"
          :class="running || sessions.refreshing ? 'animate-spin' : ''"
        />
      </button>
    </div>

    <p v-if="indexError" class="px-2 py-2 text-muted" role="alert">
      No se pudo abrir el índice. Más detalles en
      <RouterLink to="/diagnostico" class="text-text underline underline-offset-2"
        >Diagnóstico</RouterLink
      >.
    </p>
    <p v-else-if="sessions.error" class="px-2 py-2 text-sm text-danger" role="alert">
      {{ sessions.error }}
    </p>

    <ul v-if="showSkeleton" class="mt-1 flex flex-col gap-0.5" aria-label="Cargando sesiones">
      <li v-for="n in 3" :key="n" class="flex flex-col gap-1.5 px-2 py-2" aria-hidden="true">
        <span class="h-3 w-4/5 animate-pulse rounded-full bg-surface-hover" />
        <span class="h-2.5 w-1/2 animate-pulse rounded-full bg-surface-hover" />
      </li>
    </ul>

    <p v-else-if="showEmpty" class="px-2 py-2 text-muted">
      Este proyecto no tiene sesiones de Claude Code.
    </p>

    <SessionSelectionBar v-if="sessions.selecting" :order="order" />

    <div v-for="group in groups" :key="group.label" class="mt-2">
      <h3 class="px-2 py-1 text-xs text-muted">{{ group.label }}</h3>
      <ul class="flex flex-col gap-0.5">
        <li v-for="item in group.items" :key="item.sessionId">
          <SessionListItem
            :item="item"
            :now="now"
            @select="(range: boolean) => onSelect(item.sessionId, range)"
          />
        </li>
      </ul>
    </div>

    <button
      v-if="hidden > 0"
      type="button"
      class="no-drag mt-3 mb-2 ml-1 rounded-item px-2 py-1 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      :aria-pressed="sessions.showHidden"
      @click="sessions.showHidden = !sessions.showHidden"
    >
      {{ sessions.showHidden ? 'Esconder ocultas' : `Mostrar ocultas (${hidden})` }}
    </button>
  </section>
</template>
