<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import type { SystemInfo } from '../../../../shared/types'
import { useCopy } from '../../composables/useCopy'
import { useUpdateStore } from '../../stores/update'
import appIcon from '../../../../../resources/icon.png'

/** «Acerca de OpenClod». */
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
    ['Claude Code (incluido)', i.claudeCode ?? '—'],
    ['Electron', i.electron],
    ['Chromium', i.chrome],
    ['Node.js', i.node],
    ['Git', i.git ?? 'No encontrado']
  ] as const
})

const update = useUpdateStore()
const updateText = computed(() => {
  const s = update.status
  switch (s.state) {
    case 'disabled':
      return 'Las actualizaciones solo funcionan en la versión instalada.'
    case 'idle':
      return ''
    case 'checking':
      return 'Buscando actualizaciones…'
    case 'latest':
      return 'Tienes la última versión.'
    case 'downloading':
      return `Descargando la ${s.version}… ${s.percent} %`
    case 'ready':
      return `La ${s.version} está lista para instalarse.`
    case 'error':
      return s.message
  }
  return ''
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
        class="fixed top-1/2 left-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-dialog bg-surface p-6 text-center text-text shadow-float"
      >
        <img :src="appIcon" alt="" class="size-16" />
        <div>
          <DialogTitle class="font-serif text-2xl">OpenClod</DialogTitle>
          <DialogDescription class="text-sm text-muted">
            Versión {{ info?.app ?? '…' }}
          </DialogDescription>
        </div>
        <dl class="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-sm">
          <template v-for="[name, value] in rows" :key="name">
            <dt class="text-muted">{{ name }}</dt>
            <dd class="font-mono text-[13px]">{{ value }}</dd>
          </template>
        </dl>
        <div class="flex flex-col items-center gap-2 text-sm" aria-live="polite">
          <p v-if="updateText" class="text-muted">{{ updateText }}</p>
          <button
            v-if="update.status.state === 'ready'"
            type="button"
            class="h-8 rounded-item bg-accent px-3 text-on-accent hover:bg-accent-hover"
            @click="update.install()"
          >
            Reiniciar y actualizar
          </button>
          <button
            v-else-if="update.status.state !== 'disabled'"
            type="button"
            class="h-8 rounded-item px-3 hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-transparent"
            :disabled="!canCheck"
            @click="update.check()"
          >
            Buscar actualizaciones
          </button>
        </div>
        <p class="text-xs text-muted">Proyecto personal, no afiliado a Anthropic.</p>
        <div class="mt-1 flex gap-2">
          <button
            type="button"
            class="h-8 rounded-item px-3 text-sm hover:bg-surface-hover"
            @click="copyInfo"
          >
            {{ copied ? 'Copiado' : 'Copiar información' }}
          </button>
          <DialogClose
            class="h-8 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover"
          >
            Cerrar
          </DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
