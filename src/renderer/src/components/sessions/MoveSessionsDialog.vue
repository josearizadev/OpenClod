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
import { TriangleAlert } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { isLive } from '../../lib/live'
import { useProjectsStore } from '../../stores/projects'
import { useSessionsStore } from '../../stores/sessions'
import { useUiStore } from '../../stores/ui'
import ProjectIcon from '../projects/ProjectIcon.vue'

/**
 * «Mover a proyecto…»: elegir el destino de una o varias conversaciones. Sus archivos pasan a la
 * carpeta de Claude Code del destino y se continúan allí. Uno solo en la app (`App.vue`).
 */
const sessions = useSessionsStore()
const projects = useProjectsStore()
const ui = useUiStore()

const ids = ref<string[]>([])
const target = ref<string | null>(null)
const moving = ref(false)

watch(
  () => sessions.moveRequest,
  (request) => {
    if (!request) return
    ids.value = [...request]
    target.value = null
  }
)

const open = computed({
  get: () => sessions.moveRequest !== null,
  set: (value: boolean) => {
    if (!value) sessions.moveRequest = null
  }
})

/** Destinos: todos menos el proyecto en el que están (el activo) y los que ya no existen. */
const options = computed(() =>
  [projects.computer, ...projects.folders].filter(
    (p): p is NonNullable<typeof p> => !!p && p.id !== projects.activeId && !p.missing
  )
)
const count = computed(() => ids.value.length)
const title = computed(() =>
  count.value === 1
    ? t('Mover la conversación a otro proyecto')
    : t('Mover {n} conversaciones a otro proyecto', { n: count.value })
)
/** Escrita hace poco: puede tenerla abierta una terminal con `claude`. */
const recent = computed(() =>
  ids.value.some((id) =>
    isLive(sessions.items.find((i) => i.sessionId === id)?.lastWriteAt, sessions.clock)
  )
)

function conversations(n: number): string {
  return n === 1 ? t('1 conversación') : t('{n} conversaciones', { n })
}

async function confirm(): Promise<void> {
  const projectId = target.value
  const request = ids.value
  if (!projectId || request.length === 0 || moving.value) return
  moving.value = true
  const result = await sessions.move(request, projectId)
  moving.value = false
  sessions.moveRequest = null
  if (!result) return ui.toast(t('No se pudo mover'), { tone: 'danger' })
  const name = projects.projects.find((p) => p.id === projectId)?.name ?? ''
  const moved = result.moved.length
  const active = result.skipped.filter((s) => s.reason === 'active').length
  const conflict = result.skipped.filter((s) => s.reason === 'conflict').length
  const failed = result.skipped.length - active - conflict
  const parts: string[] = []
  if (moved > 0)
    parts.push(t('{conversations} movidas a {name}', { conversations: conversations(moved), name }))
  if (active > 0) parts.push(t('{n} con Claude trabajando, sin tocar', { n: active }))
  if (conflict > 0) parts.push(t('{n} ya existían en el destino', { n: conflict }))
  if (failed > 0) parts.push(t('{n} no se pudieron mover', { n: failed }))
  ui.toast(
    parts.join(' · '),
    moved === 0
      ? { tone: 'danger' }
      : { action: { label: t('Ir al proyecto'), run: () => void projects.select(projectId) } }
  )
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog bg-surface p-5 text-text shadow-float"
      >
        <DialogTitle class="font-serif text-lg">{{ title }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted">
          {{
            t(
              'Sus archivos de Claude Code pasan a la carpeta del proyecto elegido y, al continuarla, Claude trabajará allí.'
            )
          }}
        </DialogDescription>

        <div
          role="radiogroup"
          :aria-label="t('Proyecto de destino')"
          class="mt-4 -mx-1 min-h-0 flex-1 overflow-y-auto px-1"
        >
          <button
            v-for="project in options"
            :key="project.id"
            type="button"
            role="radio"
            :aria-checked="target === project.id"
            class="flex min-h-10 w-full items-center gap-2.5 rounded-item px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-hover"
            :class="target === project.id ? 'bg-surface-hover ring-1 ring-accent' : ''"
            @click="target = project.id"
            @dblclick="confirm"
          >
            <ProjectIcon :project="project" />
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ project.name }}</span>
              <span class="block truncate text-xs text-muted" :title="project.path">
                {{ project.path }}
              </span>
            </span>
          </button>
          <p v-if="options.length === 0" class="px-2 py-2 text-muted">
            {{ t('No hay otro proyecto al que moverla.') }}
          </p>
        </div>

        <p v-if="recent" class="mt-3 flex gap-2 text-sm text-warning" role="alert">
          <TriangleAlert :size="16" :stroke-width="1.75" class="mt-0.5 shrink-0" />
          {{
            t(
              'Se ha escrito hace menos de 2 minutos: si está abierta en una terminal con claude, ciérrala antes o la conversación se partirá en dos.'
            )
          }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <DialogClose
            type="button"
            class="h-8 rounded-item px-3 transition-colors duration-150 hover:bg-surface-hover"
          >
            {{ t('Cancelar') }}
          </DialogClose>
          <button
            type="button"
            :disabled="!target || moving"
            class="h-8 rounded-item bg-accent px-3 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60"
            @click="confirm"
          >
            {{ t('Mover') }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
