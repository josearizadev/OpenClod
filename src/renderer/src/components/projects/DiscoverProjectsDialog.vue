<script setup lang="ts">
import { t } from '../../i18n'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { DiscoveredProject } from '../../../../shared/projects'
import { relativeTime } from '../../lib/dates'
import { useProjectsStore } from '../../stores/projects'

/** Carpetas con sesiones de Claude Code que aún no son proyectos. */
const open = defineModel<boolean>('open', { required: true })

const projects = useProjectsStore()
const candidates = ref<DiscoveredProject[] | null>(null)
const selected = ref<string[]>([])
const importing = ref(false)
const error = ref<string | null>(null)
const now = ref(new Date())

const count = computed(() => selected.value.length)

watch(open, async (isOpen) => {
  if (!isOpen) return
  candidates.value = null
  selected.value = []
  error.value = null
  now.value = new Date()
  const found = await projects.discover()
  if (found) candidates.value = found
  else error.value = projects.error ?? t('No se pudieron buscar las carpetas.')
})

function sessionsLabel(n: number): string {
  return n === 1 ? t('1 sesión') : t('{n} sesiones', { n })
}

async function importSelected(): Promise<void> {
  if (count.value === 0) return
  importing.value = true
  // En el orden de la lista (no en el de los clics): se activa la primera.
  const paths = (candidates.value ?? [])
    .map((c) => c.path)
    .filter((path) => selected.value.includes(path))
  const ok = await projects.importMany(paths)
  importing.value = false
  if (ok) open.value = false
  else error.value = projects.error
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex max-h-[min(36rem,calc(100vh-4rem))] w-[min(35rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog bg-surface text-text shadow-float"
      >
        <header class="flex items-start gap-3 px-5 pt-5 pb-3">
          <div class="min-w-0 flex-1">
            <DialogTitle class="font-serif text-lg">{{ t('Descubrir proyectos') }}</DialogTitle>
            <DialogDescription class="mt-1 text-muted">
              {{ t('Carpetas en las que has usado Claude Code y que aún no están en OpenClod.') }}
            </DialogDescription>
          </div>
          <DialogClose
            :aria-label="t('Cerrar')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          >
            <X :size="18" :stroke-width="1.75" />
          </DialogClose>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-3">
          <p v-if="candidates === null && !error" class="px-2 py-6 text-center text-muted">
            {{ t('Buscando…') }}
          </p>
          <p
            v-else-if="candidates && candidates.length === 0"
            class="px-2 py-6 text-center text-muted"
          >
            {{ t('No hay más carpetas con sesiones de Claude Code.') }}
          </p>
          <ul v-else-if="candidates" class="flex flex-col gap-0.5 pb-2">
            <li v-for="candidate in candidates" :key="candidate.path">
              <label
                class="flex cursor-pointer items-start gap-3 rounded-item px-2 py-2 transition-colors duration-150 hover:bg-surface-hover"
              >
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="candidate.path"
                  class="mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span class="min-w-0 flex-1">
                  <span class="block font-mono text-[13px] break-all">{{ candidate.path }}</span>
                  <span class="block text-xs text-muted">
                    {{ sessionsLabel(candidate.sessionCount)
                    }}<template v-if="candidate.lastActivityAt">
                      · {{ relativeTime(candidate.lastActivityAt, now) }}</template
                    >
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </div>

        <footer class="flex items-center gap-2 px-5 pt-3 pb-5">
          <p v-if="error" class="min-w-0 flex-1 text-sm text-danger" role="alert">{{ error }}</p>
          <span v-else class="flex-1" />
          <DialogClose
            class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
          >
            {{ t('Cancelar') }}
          </DialogClose>
          <button
            type="button"
            :disabled="count === 0 || importing"
            class="h-8 rounded-item bg-accent px-3 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40"
            @click="importSelected"
          >
            {{ t('Importar ({n})', { n: count }) }}
          </button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
