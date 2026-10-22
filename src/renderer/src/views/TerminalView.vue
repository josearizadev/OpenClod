<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { Plus, RotateCw, Sparkles, SquareTerminal, X } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import TerminalPane from '../components/terminal/TerminalPane.vue'
import { useTerminalStore } from '../stores/terminal'

/**
 * Vista Terminal: pestañas y una terminal por pestaña.
 * Al salir de la vista los procesos siguen en el main; al volver se repinta su salida.
 */
const store = useTerminalStore()
const loaded = ref(false)

const unavailable = computed(() => store.shells?.error ?? null)

onMounted(async () => {
  await store.load()
  loaded.value = true
  if (store.terminals.length === 0 && !unavailable.value) await store.open('shell')
})

const menuItem =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
      role="tablist"
      aria-label="Terminales"
    >
      <div
        v-for="t in store.terminals"
        :key="t.id"
        class="group flex h-7 max-w-56 min-w-0 items-center gap-1 rounded-item pr-1 pl-2 text-sm transition-colors duration-150"
        :class="
          t.id === store.activeId ? 'bg-surface-hover text-text' : 'text-muted hover:text-text'
        "
      >
        <button
          type="button"
          role="tab"
          class="flex min-w-0 flex-1 items-center gap-1.5"
          :aria-selected="t.id === store.activeId"
          :title="`${t.title} · ${t.cwd}`"
          @click="store.activeId = t.id"
        >
          <component
            :is="t.kind === 'shell' ? SquareTerminal : Sparkles"
            :size="14"
            :stroke-width="1.75"
            class="shrink-0"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{{ t.title }}</span>
          <span
            v-if="t.status === 'exited'"
            class="size-1.5 shrink-0 rounded-full bg-muted"
            aria-label="Terminado"
          />
        </button>
        <button
          type="button"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-text"
          :aria-label="`Cerrar ${t.title}`"
          @click="store.close(t.id)"
        >
          <X :size="14" :stroke-width="1.75" />
        </button>
      </div>

      <DropdownMenuRoot v-if="!unavailable">
        <DropdownMenuTrigger
          class="inline-flex size-7 shrink-0 items-center justify-center rounded-item text-muted hover:bg-surface-hover hover:text-text"
          aria-label="Nueva terminal"
          title="Nueva terminal"
        >
          <Plus :size="16" :stroke-width="1.75" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="start"
            :side-offset="4"
            class="z-30 min-w-64 rounded-menu bg-surface p-1 text-text shadow-float"
          >
            <DropdownMenuItem :class="menuItem" @select="store.open('shell')">
              <SquareTerminal :size="16" :stroke-width="1.75" aria-hidden="true" />
              Shell en la carpeta del proyecto
            </DropdownMenuItem>
            <DropdownMenuItem :class="menuItem" @select="store.open('claude')">
              <Sparkles :size="16" :stroke-width="1.75" aria-hidden="true" />
              Nueva sesión de Claude Code
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>

    <div class="relative min-h-0 flex-1 bg-code-bg">
      <div v-if="unavailable" class="mx-auto max-w-chat px-6 py-8" role="alert">
        <p class="text-danger">La terminal no está disponible.</p>
        <p class="mt-1 font-mono text-xs text-muted">{{ unavailable }}</p>
      </div>

      <div
        v-else-if="loaded && store.terminals.length === 0"
        class="flex h-full flex-col items-center justify-center gap-3 text-muted"
      >
        <p>No hay terminales abiertas.</p>
        <div class="flex gap-2">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item border border-border bg-surface px-3 text-sm text-text hover:bg-surface-hover"
            @click="store.open('shell')"
          >
            <SquareTerminal :size="16" :stroke-width="1.75" aria-hidden="true" /> Abrir un shell
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item border border-border bg-surface px-3 text-sm text-text hover:bg-surface-hover"
            @click="store.open('claude')"
          >
            <Sparkles :size="16" :stroke-width="1.75" aria-hidden="true" /> Claude Code
          </button>
        </div>
      </div>

      <template v-for="t in store.terminals" :key="`${t.id}:${t.startedAt}`">
        <div v-show="t.id === store.activeId" class="absolute inset-0 flex flex-col">
          <div class="min-h-0 flex-1">
            <TerminalPane :info="t" :active="t.id === store.activeId" />
          </div>
          <div
            v-if="t.status === 'exited'"
            class="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-3 py-1.5 text-sm"
            role="status"
          >
            <span class="text-muted">Terminado · código {{ t.exitCode ?? '?' }}</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-item px-2 py-0.5 font-medium text-accent hover:bg-surface-hover"
              @click="store.restart(t.id)"
            >
              <RotateCw :size="14" :stroke-width="1.75" aria-hidden="true" /> Reiniciar
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
