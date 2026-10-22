<script setup lang="ts">
import { Check, ChevronDown, ClipboardList, FilePen, Hand, ShieldOff } from 'lucide-vue-next'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, ref, type Component } from 'vue'
import { MODE_LABELS, type ChatMode } from '../../../../shared/chat'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

/**
 * Modo de permisos (pregunta abierta 2): Preguntar, Aceptar ediciones y Planificar; «Saltar
 * permisos» pide confirmación cada vez que se activa. Se ve con su nombre si no es el
 * modo normal.
 */
defineProps<{ disabled?: boolean }>()

const mode = defineModel<ChatMode>({ required: true })

const MODES: { value: ChatMode; icon: Component; hint: string }[] = [
  { value: 'default', icon: Hand, hint: 'Pide permiso antes de editar o ejecutar' },
  { value: 'acceptEdits', icon: FilePen, hint: 'Edita archivos sin preguntar' },
  { value: 'plan', icon: ClipboardList, hint: 'Solo investiga y propone un plan' }
]

const icon = computed(() => MODES.find((m) => m.value === mode.value)?.icon ?? ShieldOff)
const confirming = ref(false)

function pick(value: ChatMode): void {
  if (value === 'bypassPermissions') {
    // El diálogo se abre con el menú ya cerrado (ver SessionMenu).
    setTimeout(() => (confirming.value = true), 0)
    return
  }
  mode.value = value
}

const itemClass =
  'flex min-h-8 cursor-default items-start gap-2 rounded-item px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      :disabled="disabled"
      class="inline-flex h-8 items-center gap-1.5 rounded-item px-2 text-sm transition-colors duration-150 enabled:hover:bg-surface-hover disabled:opacity-60"
      :class="
        mode === 'default'
          ? 'text-muted enabled:hover:text-text'
          : mode === 'bypassPermissions'
            ? 'text-danger'
            : 'text-text'
      "
      :aria-label="`Modo de permisos: ${MODE_LABELS[mode]}`"
    >
      <component :is="icon" :size="16" :stroke-width="1.75" aria-hidden="true" />
      <span v-if="mode !== 'default'">{{ MODE_LABELS[mode] }}</span>
      <ChevronDown :size="14" :stroke-width="1.75" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="start"
        side="top"
        :side-offset="6"
        :collision-padding="8"
        class="z-30 w-72 rounded-menu bg-surface p-1 text-text shadow-float"
      >
        <DropdownMenuItem
          v-for="option in MODES"
          :key="option.value"
          :class="itemClass"
          @select="pick(option.value)"
        >
          <component
            :is="option.icon"
            class="mt-0.5 shrink-0 text-muted"
            :size="16"
            :stroke-width="1.75"
            aria-hidden="true"
          />
          <span class="flex min-w-0 flex-1 flex-col">
            <span>{{ MODE_LABELS[option.value] }}</span>
            <span class="text-xs text-muted">{{ option.hint }}</span>
          </span>
          <Check
            v-if="mode === option.value"
            class="mt-0.5 shrink-0"
            :size="16"
            aria-hidden="true"
          />
        </DropdownMenuItem>
        <DropdownMenuSeparator class="my-1 h-px bg-border" />
        <DropdownMenuItem :class="itemClass" @select="pick('bypassPermissions')">
          <ShieldOff
            class="mt-0.5 shrink-0 text-danger"
            :size="16"
            :stroke-width="1.75"
            aria-hidden="true"
          />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-danger">{{ MODE_LABELS.bypassPermissions }}</span>
            <span class="text-xs text-muted">Usa todas las herramientas sin preguntar</span>
          </span>
          <Check
            v-if="mode === 'bypassPermissions'"
            class="mt-0.5 shrink-0"
            :size="16"
            aria-hidden="true"
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
  <ConfirmDialog
    v-model:open="confirming"
    title="¿Saltar los permisos?"
    description="Claude podrá editar archivos, ejecutar comandos y usar cualquier herramienta sin pedirte permiso en esta sesión. No se guarda como preferencia."
    confirm-label="Saltar permisos"
    danger
    @confirm="mode = 'bypassPermissions'"
  />
</template>
