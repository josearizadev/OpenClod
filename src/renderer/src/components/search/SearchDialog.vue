<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  ToggleGroupItem,
  ToggleGroupRoot,
  VisuallyHidden
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { SearchAuthor, SearchGroup, SearchHit, SearchSort } from '../../../../shared/search'
import { formatNumber } from '../../lib/tokens'
import { useProjectsStore } from '../../stores/projects'
import { useSearchStore } from '../../stores/search'
import SearchResultGroup from './SearchResultGroup.vue'

/**
 * Búsqueda global: `Ctrl+K` o «Buscar». Resultados agrupados por
 * conversación; `↑/↓` recorre, `Enter` abre el mensaje, `Esc` cierra, `Alt+P` cambia el ámbito.
 */
const search = useSearchStore()
const projects = useProjectsStore()
const router = useRouter()
const input = ref<HTMLInputElement | null>(null)
const now = ref(new Date())

interface Option {
  group: SearchGroup
  hit: SearchHit | null
}
const groups = computed(() => search.results?.groups ?? [])
const options = computed<Option[]>(() =>
  groups.value.flatMap((group) => [
    { group, hit: null },
    ...group.hits.map((hit) => ({ group, hit }))
  ])
)
/** Índice plano de la opción del título de cada grupo. */
const firsts = computed(() => {
  let index = 0
  return groups.value.map((g) => {
    const first = index
    index += 1 + g.hits.length
    return first
  })
})

const scopeModel = computed({
  get: () => search.scope,
  set: (value: string | undefined) => {
    if (value === 'project' || value === 'all') search.setScope(value)
  }
})
const authorModel = computed({
  get: () => search.author,
  set: (value: string | undefined) => {
    if (value) search.author = value as SearchAuthor
  }
})
const sortModel = computed({
  get: () => search.sort,
  set: (value: string | undefined) => {
    if (value) search.sort = value as SearchSort
  }
})

watch(
  () => search.open,
  async (open) => {
    if (!open) return
    now.value = new Date()
    await nextTick()
    input.value?.select()
  }
)

watch(
  () => search.results,
  () => void nextTick(() => requestAnimationFrame(() => search.painted()))
)

function pick(index: number): void {
  const option = options.value[index]
  if (!option) return
  const hit = option.hit ?? option.group.hits[0] ?? null
  search.open = false
  void router.push({
    name: 'session',
    params: { id: option.group.entryId },
    ...(hit ? { query: { m: hit.uuid, q: search.text.trim() } } : {})
  })
}

function move(delta: number): void {
  const count = options.value.length
  if (count === 0) return
  search.selected = (search.selected + delta + count) % count
  void nextTick(() =>
    document
      .getElementById(`busqueda-opcion-${search.selected}`)
      ?.scrollIntoView({ block: 'nearest' })
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    pick(search.selected)
  } else if (event.altKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    search.toggleScope()
  }
}

const summary = computed(() => {
  const r = search.results
  if (!r) return ''
  const hits = r.total === 1 ? '1 coincidencia' : `${formatNumber(r.total)} coincidencias`
  const convs =
    r.groups.length === 1 ? '1 conversación' : `${formatNumber(r.groups.length)} conversaciones`
  return `${hits} en ${convs}`
})

const segmented =
  'h-7 rounded-item px-2.5 text-sm text-muted transition-colors duration-150 hover:text-text data-[state=on]:bg-surface-hover data-[state=on]:text-text disabled:opacity-40'
</script>

<template>
  <DialogRoot v-model:open="search.open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-dialog bg-surface text-text shadow-float"
        @open-auto-focus.prevent="input?.select()"
      >
        <VisuallyHidden>
          <DialogTitle>Buscar</DialogTitle>
          <DialogDescription>Busca en tus prompts y en las respuestas de Claude.</DialogDescription>
        </VisuallyHidden>
        <div class="flex items-center gap-2 border-b border-border px-4">
          <Search :size="18" :stroke-width="1.75" class="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref="input"
            v-model="search.text"
            type="text"
            maxlength="500"
            placeholder="Buscar en las conversaciones…"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="busqueda-resultados"
            :aria-activedescendant="
              options.length ? `busqueda-opcion-${search.selected}` : undefined
            "
            class="h-12 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            @keydown="onKeydown"
          />
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
          <ToggleGroupRoot
            v-model="scopeModel"
            type="single"
            aria-label="Ámbito (Alt+P)"
            class="flex gap-0.5"
          >
            <ToggleGroupItem value="project" :disabled="!projects.activeId" :class="segmented">
              Este proyecto
            </ToggleGroupItem>
            <ToggleGroupItem value="all" :class="segmented">Todos</ToggleGroupItem>
          </ToggleGroupRoot>
          <ToggleGroupRoot
            v-model="authorModel"
            type="single"
            aria-label="Autor"
            class="flex gap-0.5"
          >
            <ToggleGroupItem value="all" :class="segmented">Todo</ToggleGroupItem>
            <ToggleGroupItem value="user" :class="segmented">Tú</ToggleGroupItem>
            <ToggleGroupItem value="assistant" :class="segmented">Claude</ToggleGroupItem>
          </ToggleGroupRoot>
          <ToggleGroupRoot
            v-model="sortModel"
            type="single"
            aria-label="Orden"
            class="ml-auto flex gap-0.5"
          >
            <ToggleGroupItem value="relevance" :class="segmented">Relevancia</ToggleGroupItem>
            <ToggleGroupItem value="date" :class="segmented">Más recientes</ToggleGroupItem>
          </ToggleGroupRoot>
        </div>

        <div
          v-if="search.results?.indexing"
          class="flex flex-col gap-1 border-b border-border px-4 py-2 text-sm text-muted"
          role="status"
        >
          Indexando {{ formatNumber(search.results.indexing.done) }} de
          {{ formatNumber(search.results.indexing.total) }} sesiones…
          <div class="h-0.5 overflow-hidden rounded-full bg-surface-hover">
            <div
              class="h-full bg-accent"
              :style="{
                width: `${Math.round((100 * search.results.indexing.done) / Math.max(1, search.results.indexing.total))}%`
              }"
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <p v-if="search.error" class="px-3 py-6 text-sm text-danger" role="alert">
            La búsqueda no está disponible: {{ search.error }}
          </p>
          <p v-else-if="!search.text.trim()" class="px-3 py-6 text-sm text-muted">
            Busca en lo que dijiste tú y lo que respondió Claude.
          </p>
          <div
            v-else-if="search.results && groups.length === 0 && !search.loading"
            class="flex flex-wrap items-center gap-2 px-3 py-6 text-sm text-muted"
          >
            <span>{{
              search.scope === 'project' ? 'Sin resultados en este proyecto' : 'Sin resultados'
            }}</span>
            <template v-if="search.scope === 'project'">
              <span aria-hidden="true">·</span>
              <button
                type="button"
                class="font-medium text-accent hover:text-accent-hover"
                @click="search.setScope('all')"
              >
                Buscar en todos
              </button>
            </template>
          </div>
          <div v-else id="busqueda-resultados" role="listbox" aria-label="Resultados">
            <SearchResultGroup
              v-for="(group, index) in groups"
              :key="group.entryId"
              :group="group"
              :first="firsts[index] ?? 0"
              :selected="search.selected"
              :now="now"
              @pick="pick"
              @hover="search.selected = $event"
            />
          </div>
        </div>

        <div
          v-if="search.results && groups.length > 0"
          class="border-t border-border px-4 py-2 text-xs text-muted"
        >
          {{ summary }} · {{ search.results.durationMs }} ms
          <span v-if="search.results.literal"> · buscado como texto literal</span>
        </div>
        <p class="sr-only" role="status" aria-live="polite">{{ summary }}</p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
