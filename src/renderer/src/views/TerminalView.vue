<script setup lang="ts">
import { t } from '../i18n'
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
      :aria-label="t('Terminales')"
    >
      <div
        v-for="term in store.terminals"
        :key="term.id"
        class="group flex h-7 max-w-56 min-w-0 items-center gap-1 rounded-item pr-1 pl-2 text-sm transition-colors duration-150"
        :class="
          term.id === store.activeId ? 'bg-surface-hover text-text' : 'text-muted hover:text-text'
        "
      >
        <button
          type="button"
          role="tab"
          class="flex min-w-0 flex-1 items-center gap-1.5"
          :aria-selected="term.id === store.activeId"
          :title="`${term.title} · ${term.cwd}`"
          @click="store.activeId = term.id"
        >
          <component
            :is="term.kind === 'shell' ? SquareTerminal : Sparkles"
            :size="14"
            :stroke-width="1.75"
            class="shrink-0"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{{ term.title }}</span>
          <span
            v-if="term.status === 'exited'"
            class="size-1.5 shrink-0 rounded-full bg-muted"
            :aria-label="t('Terminado')"
          />
        </button>
        <button
          type="button"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-text"
          :aria-label="t('Cerrar {name}', { name: term.title })"
          @click="store.close(term.id)"
        >
          <X :size="14" :stroke-width="1.75" />
        </button>
      </div>

      <DropdownMenuRoot v-if="!unavailable">
        <DropdownMenuTrigger
          class="inline-flex size-7 shrink-0 items-center justify-center rounded-item text-muted hover:bg-surface-hover hover:text-text"
          :aria-label="t('Nueva terminal')"
          :title="t('Nueva terminal')"
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
              {{ t('Shell en la carpeta del proyecto') }}
            </DropdownMenuItem>
            <DropdownMenuItem :class="menuItem" @select="store.open('claude')">
              <Sparkles :size="16" :stroke-width="1.75" aria-hidden="true" />
              {{ t('Nueva sesión de Claude Code') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>

    <div class="relative min-h-0 flex-1 bg-code-bg">
      <div v-if="unavailable" class="mx-auto max-w-chat px-6 py-8" role="alert">
        <p class="text-danger">{{ t('La terminal no está disponible.') }}</p>
        <p class="mt-1 font-mono text-xs text-muted">{{ unavailable }}</p>
      </div>

      <div
        v-else-if="loaded && store.terminals.length === 0"
        class="flex h-full flex-col items-center justify-center gap-3 text-muted"
      >
        <p>{{ t('No hay terminales abiertas.') }}</p>
        <div class="flex gap-2">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item border border-border bg-surface px-3 text-sm text-text hover:bg-surface-hover"
            @click="store.open('shell')"
          >
            <SquareTerminal :size="16" :stroke-width="1.75" aria-hidden="true" />
            {{ t('Abrir un shell') }}
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

      <template v-for="term in store.terminals" :key="`${term.id}:${term.startedAt}`">
        <div v-show="term.id === store.activeId" class="absolute inset-0 flex flex-col">
          <div class="min-h-0 flex-1">
            <TerminalPane :info="term" :active="term.id === store.activeId" />
          </div>
          <div
            v-if="term.status === 'exited'"
            class="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-3 py-1.5 text-sm"
            role="status"
          >
            <span class="text-muted">{{
              t('Terminado · código {code}', { code: String(term.exitCode ?? '?') })
            }}</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-item px-2 py-0.5 font-medium text-accent hover:bg-surface-hover"
              @click="store.restart(term.id)"
            >
              <RotateCw :size="14" :stroke-width="1.75" aria-hidden="true" />
              {{ t('Reiniciar') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
