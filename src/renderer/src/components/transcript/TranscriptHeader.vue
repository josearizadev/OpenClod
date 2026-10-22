<script setup lang="ts">
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  TooltipTrigger
} from 'reka-ui'
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  Info,
  SlidersHorizontal,
  Star
} from 'lucide-vue-next'
import { computed } from 'vue'
import type { ChatStatus } from '../../../../shared/chat'
import type { SessionDetail } from '../../../../shared/projects'
import type { Viewer } from '../../../../shared/types'
import { useLiveClock } from '../../composables/useLiveClock'
import { relativeTime } from '../../lib/dates'
import { isLive } from '../../lib/live'
import { formatTokens, totalTokens } from '../../lib/tokens'
import TokenBreakdown from '../sessions/TokenBreakdown.vue'
import IconButton from '../ui/IconButton.vue'
import SessionDetails from './SessionDetails.vue'

/**
 * Cabecera compacta del transcript: título, fecha · rama · tokens y, a la
 * derecha, favorita, filtros, «Detalles» con la ficha de la sesión y el menú ⋯.
 */
const props = defineProps<{
  detail: SessionDetail
  viewer: Viewer
  invalidLines?: number
  /** El transcript no está arriba del todo: se ve el borde inferior. */
  scrolled?: boolean
  /** Estado del chat activo; `null` = sin chat. */
  chatStatus?: ChatStatus | null
  /** Qué hace Claude ahora («Pensando…», «Ejecutando npm test»…). */
  chatActivity?: string | null
}>()

const CHAT_STATUS: Partial<Record<ChatStatus, { label: string; tone: string }>> = {
  starting: { label: 'Iniciando…', tone: 'text-muted' },
  working: { label: 'Trabajando…', tone: 'text-accent' },
  waiting: { label: 'Esperando permiso', tone: 'text-warning' }
}
const chatBadge = computed(() => {
  const badge = props.chatStatus ? CHAT_STATUS[props.chatStatus] : undefined
  return badge && props.chatActivity ? { ...badge, label: props.chatActivity } : badge
})

const emit = defineEmits<{
  favorite: [value: boolean]
  viewer: [patch: Partial<Viewer>]
  foldAll: [open: boolean]
}>()

const when = computed(() => relativeTime(props.detail.updatedAt, new Date()))
/** Escrita hace < 2 min fuera de la app: sin chat activo de la app. */
const liveClock = useLiveClock(() => [props.detail.lastWriteAt])
const live = computed(
  () =>
    (!props.chatStatus || props.chatStatus === 'closed') &&
    isLive(props.detail.lastWriteAt, liveClock.value)
)
const tokens = computed(() => formatTokens(totalTokens(props.detail.usage)))

const filters = [
  { key: 'tools', label: 'Herramientas' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'internal', label: 'Avisos internos' }
] as const

const menuItem =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <header
    class="shrink-0 border-b px-6 py-2 transition-colors duration-150"
    :class="scrolled ? 'border-border' : 'border-transparent'"
  >
    <div class="mx-auto flex max-w-chat min-w-0 items-center gap-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <h2 class="truncate font-serif text-lg leading-snug" :title="detail.title">
          {{ detail.title }}
        </h2>
        <p class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span
            v-if="chatBadge"
            class="max-w-80 min-w-0 truncate font-medium"
            :title="chatBadge.label"
            :class="chatBadge.tone"
            role="status"
            >{{ chatBadge.label }}</span
          >
          <span v-if="chatBadge && when" aria-hidden="true">·</span>
          <span v-if="when" class="shrink-0">{{ when }}</span>
          <span
            v-if="live"
            class="inline-flex shrink-0 items-center gap-1.5 text-live"
            title="En vivo: se está escribiendo fuera de la app"
          >
            <span class="live-dot" aria-hidden="true" />
            En vivo
          </span>
          <template v-if="detail.gitBranch">
            <span aria-hidden="true">·</span>
            <GitBranch :size="12" :stroke-width="1.75" class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ detail.gitBranch }}</span>
          </template>
          <span aria-hidden="true">·</span>
          <TooltipRoot :delay-duration="300">
            <TooltipTrigger as-child>
              <span class="shrink-0 tabular-nums" tabindex="0" :aria-label="`${tokens} tokens`">
                {{ tokens }} tokens
              </span>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="bottom"
                :side-offset="6"
                :collision-padding="8"
                class="z-30 rounded-menu bg-surface px-3 py-2 text-text shadow-float"
              >
                <p class="mb-1 text-xs font-medium">Tokens</p>
                <TokenBreakdown :usage="detail.usage" />
              </TooltipContent>
            </TooltipPortal>
          </TooltipRoot>
        </p>
      </div>

      <IconButton
        :icon="Star"
        :label="detail.favorite ? 'Quitar de favoritas' : 'Marcar como favorita'"
        :class="detail.favorite ? '[&_svg]:fill-current text-accent hover:text-accent' : ''"
        :aria-pressed="detail.favorite"
        @click="emit('favorite', !detail.favorite)"
      />

      <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
          <IconButton :icon="SlidersHorizontal" label="Filtros" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            :side-offset="4"
            :collision-padding="8"
            class="z-30 min-w-52 rounded-menu bg-surface p-1 text-text shadow-float"
          >
            <DropdownMenuLabel class="px-2 py-1 text-xs text-muted">Mostrar</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              v-for="filter in filters"
              :key="filter.key"
              :model-value="viewer[filter.key]"
              :class="menuItem"
              @update:model-value="(value) => emit('viewer', { [filter.key]: value === true })"
              @select.prevent
            >
              <span class="flex size-4 items-center justify-center">
                <DropdownMenuItemIndicator>
                  <Check :size="16" :stroke-width="2" />
                </DropdownMenuItemIndicator>
              </span>
              {{ filter.label }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator class="my-1 h-px bg-border" />
            <DropdownMenuItem :class="menuItem" @select="emit('foldAll', true)">
              <ChevronsUpDown :size="16" :stroke-width="1.75" aria-hidden="true" />
              Desplegar todo
            </DropdownMenuItem>
            <DropdownMenuItem :class="menuItem" @select="emit('foldAll', false)">
              <ChevronsDownUp :size="16" :stroke-width="1.75" aria-hidden="true" />
              Plegar todo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>

      <PopoverRoot>
        <PopoverTrigger as-child>
          <IconButton :icon="Info" label="Detalles" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="end"
            :side-offset="4"
            :collision-padding="8"
            class="z-30 max-h-[min(36rem,calc(100vh-6rem))] w-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-menu bg-surface p-4 text-text shadow-float"
          >
            <SessionDetails :detail="detail" :invalid-lines="invalidLines" />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>

      <slot name="actions" />
      <slot name="menu" />
    </div>
  </header>
</template>
