<script setup lang="ts">
import { t } from '../../i18n'
import {
  ContextMenuContent,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  TooltipTrigger
} from 'reka-ui'
import { Archive, CircleCheck, Ellipsis, GitBranch, Link2, Star } from 'lucide-vue-next'
import { computed } from 'vue'
import type { SessionListItem } from '../../../../shared/projects'
import { isLive } from '../../lib/live'
import { relativeTime } from '../../lib/dates'
import { formatTokens, totalTokens } from '../../lib/tokens'
import { useChatStore } from '../../stores/chat'
import { useSessionsStore } from '../../stores/sessions'
import { useTabsStore } from '../../stores/tabs'
import SessionMenu from './SessionMenu.vue'
import TokenBreakdown from './TokenBreakdown.vue'

/**
 * Fila de la lista: título y, debajo, fecha relativa ·
 * rama · tokens. Estrella si es favorita, atenuada si está archivada. Acciones con el botón ⋯ (al
 * pasar o con foco), el menú contextual o `F2` (renombrar). `Ctrl`/`Mayús`+clic, o un clic con
 * selección activa, marca la fila en vez de abrirla.
 */
const props = defineProps<{ item: SessionListItem; now: Date }>()
const emit = defineEmits<{ select: [range: boolean] }>()

const sessions = useSessionsStore()
const chat = useChatStore()

/** Sesión de chat activa: trabajando, esperando permiso o en reposo. */
const chatStatus = computed(() => {
  const status = chat.statusOf(props.item.sessionId)
  if (!status || status === 'closed') return null
  if (status === 'waiting') return { label: t('Esperando permiso'), dot: 'bg-warning' }
  if (status === 'working' || status === 'starting')
    return { label: t('Trabajando'), dot: 'bg-accent motion-safe:animate-pulse' }
  return { label: t('Activa, en reposo'), dot: 'border border-muted' }
})
const when = computed(() => relativeTime(props.item.updatedAt, props.now))
/** Escrita hace < 2 min fuera de la app: el chat activo ya tiene su punto. */
const live = computed(() => !chatStatus.value && isLive(props.item.lastWriteAt, sessions.clock))
const tokens = computed(() => formatTokens(totalTokens(props.item.usage)))
const chainTitle = computed(() =>
  t('Conversación continuada ({n} sesiones)', { n: props.item.chainLength })
)

const selected = computed(() => sessions.isSelected(props.item.sessionId))

/** En captura: va antes que la navegación de `RouterLink`, que respeta `defaultPrevented`. */
function onClickCapture(event: MouseEvent): void {
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !sessions.selecting) return
  event.preventDefault()
  emit('select', event.shiftKey)
}

/** `Mayús+clic` marca un rango: sin esto, el navegador seleccionaría el texto de la lista. */
function onMouseDown(event: MouseEvent): void {
  // Mayús: sin selección de texto; botón central: sin el desplazamiento automático.
  if (event.shiftKey || event.button === 1) event.preventDefault()
}

/** Clic central: en una pestaña nueva (y nunca en otra ventana). */
const tabs = useTabsStore()
function onAuxClick(event: MouseEvent): void {
  if (event.button !== 1) return
  event.preventDefault()
  tabs.openInNewTab(props.item.sessionId)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'F2') return
  event.preventDefault()
  sessions.startRename(props.item.sessionId, props.item.title)
}

const menuContent = 'z-30 min-w-56 rounded-menu bg-surface p-1 text-text shadow-float'
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="group relative" :class="item.hidden ? 'opacity-60' : ''">
        <TooltipRoot :delay-duration="500">
          <TooltipTrigger as-child>
            <RouterLink
              :to="{ name: 'session', params: { id: item.sessionId } }"
              class="no-drag flex flex-col gap-0.5 rounded-item py-1.5 pr-8 pl-2 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-offset-[-2px] aria-[current=page]:bg-surface-hover"
              :class="selected ? 'bg-surface-hover' : ''"
              :aria-selected="sessions.selecting ? selected : undefined"
              @mousedown="onMouseDown"
              @auxclick="onAuxClick"
              @click.capture="onClickCapture"
              @keydown="onKeydown"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <CircleCheck
                  v-if="selected"
                  :size="14"
                  :stroke-width="2"
                  class="shrink-0 text-accent"
                  :aria-label="t('Seleccionada')"
                />
                <Star
                  v-if="item.favorite"
                  :size="12"
                  :stroke-width="1.75"
                  class="shrink-0 fill-current text-accent"
                  :aria-label="t('Favorita')"
                />
                <span
                  v-if="chatStatus"
                  class="size-2 shrink-0 rounded-full"
                  :class="chatStatus.dot"
                  role="img"
                  :title="chatStatus.label"
                  :aria-label="chatStatus.label"
                />
                <span
                  v-else-if="live"
                  class="live-dot"
                  role="img"
                  :title="t('En vivo: se está escribiendo fuera de la app')"
                  :aria-label="t('En vivo: se está escribiendo fuera de la app')"
                />
                <span class="truncate">{{ item.title }}</span>
                <span
                  v-if="item.chainLength > 1"
                  class="shrink-0 text-muted"
                  role="img"
                  :title="chainTitle"
                  :aria-label="chainTitle"
                >
                  <Link2 :size="14" :stroke-width="1.75" aria-hidden="true" />
                </span>
                <Archive
                  v-if="item.hidden"
                  :size="12"
                  :stroke-width="1.75"
                  class="shrink-0 text-muted"
                  :aria-label="t('Archivada')"
                />
              </span>
              <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                <span v-if="when" class="shrink-0">{{ when }}</span>
                <template v-if="item.gitBranch">
                  <span aria-hidden="true">·</span>
                  <GitBranch :size="12" :stroke-width="1.75" class="shrink-0" aria-hidden="true" />
                  <span class="min-w-0 truncate">{{ item.gitBranch }}</span>
                </template>
                <span aria-hidden="true">·</span>
                <span class="shrink-0 tabular-nums" :aria-label="`${tokens} tokens`">{{
                  tokens
                }}</span>
              </span>
            </RouterLink>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              side="right"
              :side-offset="8"
              :collision-padding="8"
              class="z-30 rounded-menu bg-surface px-3 py-2 text-text shadow-float"
            >
              <p class="mb-1 text-xs font-medium">{{ t('Tokens') }}</p>
              <TokenBreakdown :usage="item.usage" />
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>

        <DropdownMenuRoot>
          <DropdownMenuTrigger
            :aria-label="t('Acciones de «{title}»', { title: item.title })"
            class="no-drag absolute top-1.5 right-1 inline-flex size-6 items-center justify-center rounded-[6px] text-muted opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-text focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <Ellipsis :size="16" :stroke-width="1.75" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              align="start"
              side="right"
              :side-offset="4"
              :collision-padding="8"
              :class="menuContent"
            >
              <SessionMenu
                kind="dropdown"
                in-list
                :session-id="item.sessionId"
                :title="item.title"
                :favorite="item.favorite"
                :hidden="item.hidden"
              />
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent :collision-padding="8" :class="menuContent">
        <SessionMenu
          kind="context"
          in-list
          :session-id="item.sessionId"
          :title="item.title"
          :favorite="item.favorite"
          :hidden="item.hidden"
        />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
