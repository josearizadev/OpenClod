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
import { computed } from 'vue'
import type { ChromeState } from '../../../../shared/chat'
import SettingRow from '../settings/SettingRow.vue'
import SettingSwitch from '../settings/SettingSwitch.vue'

/**
 * `/chrome`: Claude en Chrome en esta sesión y, si hay proyecto, en todas
 * las suyas. Activarlo relanza Claude Code con `--chrome` sin perder la conversación.
 */
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  chrome: ChromeState
  /** `null` = la carpeta no es un proyecto importado. */
  project: boolean | null
  /** Sesión aún sin empezar: se aplica al enviar el primer mensaje. */
  draft?: boolean
}>()

const emit = defineEmits<{ session: [enabled: boolean]; project: [enabled: boolean] }>()

const STATUS: Record<ChromeState['status'], string> = {
  off: t('Desactivado.'),
  pending: t('Activado: se conecta al enviar el siguiente mensaje.'),
  connected: t('Conectado a Chrome.'),
  failed: t('No conecta: comprueba que Chrome está abierto con la extensión Claude in Chrome.')
}

const status = computed(() =>
  props.draft && props.chrome.enabled
    ? t('Activado: se conecta al empezar la sesión.')
    : STATUS[props.chrome.status]
)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-dialog bg-surface p-5 text-text shadow-float"
      >
        <DialogTitle class="font-serif text-lg">{{ t('Claude en Chrome') }}</DialogTitle>
        <DialogDescription class="text-sm text-muted">
          {{
            t(
              'Claude puede abrir pestañas, leer páginas y hacer clic en tu Chrome con tus sesiones iniciadas. Necesita la extensión Claude in Chrome.'
            )
          }}
        </DialogDescription>
        <div class="divide-y divide-border">
          <SettingRow :label="t('En esta sesión')" for="chrome-sesion" :description="status">
            <SettingSwitch
              id="chrome-sesion"
              :model-value="chrome.enabled"
              @update:model-value="emit('session', $event)"
            />
          </SettingRow>
          <SettingRow
            v-if="project !== null"
            :label="t('En todas las sesiones del proyecto')"
            for="chrome-proyecto"
            :description="t('Las nuevas y las que se reanuden.')"
          >
            <SettingSwitch
              id="chrome-proyecto"
              :model-value="project"
              @update:model-value="emit('project', $event)"
            />
          </SettingRow>
        </div>
        <div class="mt-2 flex justify-end">
          <DialogClose
            class="h-8 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover"
          >
            {{ t('Hecho') }}
          </DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
