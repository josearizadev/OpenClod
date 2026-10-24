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
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Github,
  Globe,
  Info,
  LoaderCircle,
  RefreshCw
} from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { SystemInfo } from '../../../../shared/types'
import { useCopy } from '../../composables/useCopy'
import { useUpdateStore } from '../../stores/update'
import appIcon from '../../../../../resources/icon.png'

/** «Acerca de OpenClod». */
const REPO_URL = 'https://github.com/josearizadev/OpenClod'
const WEB_URL = 'https://openclod.joseariza.dev/'

const open = defineModel<boolean>('open', { required: true })

const info = ref<SystemInfo | null>(null)
watch(open, async (value) => {
  if (!value || info.value) return
  const result = await window.api.system.info()
  if (result.ok) info.value = result.data
})

const rows = computed(() => {
  const i = info.value
  if (!i) return []
  return [
    [t('Claude Code (incluido)'), i.claudeCode ?? '—'],
    ['Electron', i.electron],
    ['Chromium', i.chrome],
    ['Node.js', i.node],
    ['Git', i.git ?? t('No encontrado')]
  ] as const
})

const update = useUpdateStore()
const updateText = computed(() => {
  const s = update.status
  switch (s.state) {
    case 'disabled':
      return t('Las actualizaciones solo funcionan en la versión instalada.')
    case 'idle':
      return ''
    case 'checking':
      return t('Buscando actualizaciones…')
    case 'latest':
      return t('Tienes la última versión.')
    case 'downloading':
      return t('Descargando la {version}… {pct} %', { version: s.version, pct: s.percent })
    case 'ready':
      return t('La {version} está lista para instalarse.', { version: s.version })
    case 'error':
      return s.message
  }
  return ''
})
const updateIcon = computed(() => {
  switch (update.status.state) {
    case 'checking':
      return LoaderCircle
    case 'downloading':
    case 'ready':
      return Download
    case 'error':
      return CircleAlert
    case 'disabled':
      return Info
    default:
      return CircleCheck
  }
})
const canCheck = computed(() => ['idle', 'latest', 'error'].includes(update.status.state))

const { copied, copy } = useCopy()
function copyInfo(): void {
  if (!info.value) return
  copy([`OpenClod ${info.value.app}`, ...rows.value.map(([k, v]) => `${k}: ${v}`)].join('\n'))
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-dialog bg-surface p-6 text-text shadow-float"
        @open-auto-focus.prevent
      >
        <header class="flex items-center gap-4">
          <img :src="appIcon" alt="" class="size-14 shrink-0" />
          <div class="min-w-0">
            <DialogTitle class="font-serif text-2xl leading-tight">OpenClod</DialogTitle>
            <DialogDescription class="mt-0.5 text-sm text-muted">
              {{ t('Versión {version}', { version: info?.app ?? '…' }) }}
            </DialogDescription>
          </div>
        </header>

        <section
          v-if="update.status.state !== 'disabled' || updateText"
          class="flex items-center gap-3 rounded-menu bg-bg-sidebar px-3 py-2.5 text-sm"
          aria-live="polite"
        >
          <component
            :is="updateIcon"
            :size="16"
            :stroke-width="1.75"
            aria-hidden="true"
            :class="[
              'shrink-0',
              update.status.state === 'error' ? 'text-danger' : 'text-accent',
              update.status.state === 'checking' ? 'motion-safe:animate-spin' : ''
            ]"
          />
          <p class="min-w-0 flex-1 text-muted">
            {{ updateText || t('Comprueba si hay una versión nueva.') }}
          </p>
          <button
            v-if="update.status.state === 'ready'"
            type="button"
            class="h-7 shrink-0 rounded-item bg-accent px-2.5 text-xs text-on-accent transition-colors duration-150 hover:bg-accent-hover"
            @click="update.install()"
          >
            {{ t('Reiniciar') }}
          </button>
          <button
            v-else-if="update.status.state !== 'disabled'"
            type="button"
            class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-item px-2 text-xs transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-transparent"
            :disabled="!canCheck"
            @click="update.check()"
          >
            <RefreshCw :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('Buscar') }}
          </button>
        </section>

        <dl class="divide-y divide-border text-sm">
          <div
            v-for="[name, value] in rows"
            :key="name"
            class="flex items-baseline justify-between gap-4 py-1.5"
          >
            <dt class="text-muted">{{ name }}</dt>
            <dd class="truncate font-mono text-[13px]">{{ value }}</dd>
          </div>
        </dl>

        <nav class="grid grid-cols-2 gap-2 text-sm" :aria-label="t('Enlaces')">
          <a
            :href="REPO_URL"
            target="_blank"
            rel="noreferrer"
            class="group flex items-center gap-2 rounded-item px-3 py-2 shadow-float transition-colors duration-150 hover:bg-surface-hover"
          >
            <Github :size="16" :stroke-width="1.75" aria-hidden="true" />
            GitHub
            <ExternalLink
              :size="12"
              class="ml-auto text-muted opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </a>
          <a
            :href="WEB_URL"
            target="_blank"
            rel="noreferrer"
            class="group flex items-center gap-2 rounded-item px-3 py-2 shadow-float transition-colors duration-150 hover:bg-surface-hover"
          >
            <Globe :size="16" :stroke-width="1.75" aria-hidden="true" />
            Web
            <ExternalLink
              :size="12"
              class="ml-auto text-muted opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </a>
        </nav>

        <footer class="flex items-center gap-2 border-t border-border pt-4">
          <p class="mr-auto text-xs text-muted">
            {{ t('Código abierto (MIT).') }}<br />{{ t('No afiliado a Anthropic.') }}
          </p>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item px-3 text-sm transition-colors duration-150 hover:bg-surface-hover"
            @click="copyInfo"
          >
            <Copy :size="14" :stroke-width="1.75" aria-hidden="true" />
            {{ copied ? t('Copiado') : t('Copiar') }}
          </button>
          <DialogClose
            class="h-8 rounded-item bg-accent px-4 text-sm text-on-accent transition-colors duration-150 hover:bg-accent-hover"
          >
            {{ t('Cerrar') }}
          </DialogClose>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
