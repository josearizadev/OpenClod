<script setup lang="ts">
import { t } from '../i18n'
import { Ellipsis, PanelRight } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChatAttachment, ChatMode, ChromeState } from '../../../shared/chat'
import ChromeChip from '../components/commands/ChromeChip.vue'
import SlashCommandHost from '../components/commands/SlashCommandHost.vue'
import { slashEntries } from '../lib/slash-commands'
import { useRoute, useRouter } from 'vue-router'
import type { SessionDetail } from '../../../shared/projects'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import BackgroundTasks from '../components/chat/BackgroundTasks.vue'
import ChatErrorNotice from '../components/chat/ChatErrorNotice.vue'
import RateLimitNotice from '../components/chat/RateLimitNotice.vue'
import ActivityRow from '../components/chat/ActivityRow.vue'
import Composer from '../components/chat/Composer.vue'
import IncognitoHeader from '../components/chat/IncognitoHeader.vue'
import PermissionCard from '../components/chat/PermissionCard.vue'
import PlanCard from '../components/chat/PlanCard.vue'
import QuestionCard from '../components/chat/QuestionCard.vue'
import QueuedChips from '../components/chat/QueuedChips.vue'
import FilesPanel from '../components/files/FilesPanel.vue'
import SessionMenu from '../components/sessions/SessionMenu.vue'
import IconButton from '../components/ui/IconButton.vue'
import FindBar from '../components/transcript/FindBar.vue'
import TranscriptHeader from '../components/transcript/TranscriptHeader.vue'
import TranscriptList from '../components/transcript/TranscriptList.vue'
import { provideChatContext } from '../composables/useChatContext'
import { provideFoldState } from '../composables/useFoldState'
import { useTranscriptNav } from '../composables/useTranscriptNav'
import {
  blockOfUuid,
  buildBlocks,
  diskIds,
  mergeLive,
  thinkingStepOf,
  type Block,
  type BlockKind
} from '../lib/transcript/blocks'
import { normalizeForSearch } from '../../../shared/search'
import { touchedFiles } from '../lib/transcript/files'
import { activityLabel } from '../lib/chat-activity'
import { findInItems, hitId, type FindHit } from '../lib/transcript/find'
import { useShortcut } from '../composables/useShortcut'
import { useChatStore } from '../stores/chat'
import { useFilesStore } from '../stores/files'
import { useSessionsStore } from '../stores/sessions'
import { useTranscriptStore } from '../stores/transcript'
import { useUiStore } from '../stores/ui'

/**
 * Sesión abierta: cabecera + transcript virtualizado y, si tiene chat
 * activo, lo que llega en vivo unido a lo de disco.
 */
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const sessions = useSessionsStore()
const transcript = useTranscriptStore()
const chat = useChatStore()
const fold = provideFoldState()

const detail = ref<SessionDetail | null>(null)
const id = computed(() => String(route.params['id'] ?? ''))
const live = computed(() => chat.stateOf(id.value))
/** De incógnito: no hay nada en disco; todo es lo vivo del chat. */
const incognito = computed(() => live.value?.incognito === true)
const working = computed(() => {
  const status = live.value?.status
  return status === 'working' || status === 'waiting' || status === 'starting'
})
/** «Pensando…», «Ejecutando npm test»…. */
const activity = computed(() => {
  const s = live.value
  return s
    ? activityLabel({
        status: s.status,
        activity: s.activity,
        live: s.live,
        draft: s.draft,
        cwd: transcript.payload?.cwd ?? s.cwd
      })
    : null
})
/** Al final del transcript, salvo mientras llega texto (tiene su indicador) o hay tarjetas. */
const activityRow = computed(
  () =>
    activity.value !== null &&
    live.value?.status === 'working' &&
    !live.value.draft?.text.trim() &&
    live.value.permissions.length === 0
)

// --- Panel derecho de archivos -------------------------------------------------

const filesOpen = computed({
  get: () => ui.chat.filesPanel,
  set: (open: boolean) => void ui.setChat({ filesPanel: open })
})
const filesStore = useFilesStore()
watch(id, () => filesStore.reset())

/** Los archivos salen del transcript (disco + vivo) y de los subagentes en vivo. */
const files = computed(() => {
  const p = transcript.payload
  const state = live.value
  const items = mergeLive(p?.items ?? [], state?.live ?? [])
  const subagents = Object.values(state?.liveSubagents ?? {}).flat()
  return touchedFiles(
    subagents.length ? [...items, ...subagents] : items,
    p?.cwd ?? state?.cwd ?? undefined,
    { running: working.value }
  )
})

function openFile(path: string): void {
  const slashed = path.replace(/\\/g, '/')
  const target = /^[a-zA-Z]:/.test(slashed) ? slashed.toLowerCase() : slashed
  const file = files.value.find((f) => f.key === target || target.endsWith(`/${f.key}`))
  if (file) filesStore.open({ source: 'session', key: file.key, path: file.path })
  else {
    filesStore.reset()
    filesOpen.value = true
  }
}

/** A 900 px el panel se superpone al transcript: no lo estrecha por debajo de 560 px. */
const row = ref<HTMLElement | null>(null)
const overlay = ref(false)
let rowObserver: ResizeObserver | null = null
watch(row, (el) => {
  rowObserver?.disconnect()
  if (!el) return
  rowObserver = new ResizeObserver(() => (overlay.value = el.clientWidth < 560 + 320))
  rowObserver.observe(el)
})
onBeforeUnmount(() => rowObserver?.disconnect())

/** Lleva a la llamada de una herramienta y la despliega (avisos y tareas). */
function jumpToTool(toolUseId: string): void {
  if (!list.value?.scrollToTool(toolUseId)) return
  const block = blocks.value.find(
    (b) => b.kind === 'tools' && b.calls.some((c) => c.id === toolUseId)
  )
  if (block) fold.set(block.key, true)
}
provideChatContext({
  liveSubagents: computed(() => live.value?.liveSubagents ?? {}),
  working,
  openFile,
  runningTools: computed(
    () =>
      new Set(
        (live.value?.tasks ?? []).flatMap((t) =>
          t.status === 'running' && t.toolUseId ? [t.toolUseId] : []
        )
      )
  ),
  jumpToTool
})
const list = ref<InstanceType<typeof TranscriptList> | null>(null)
const scrolled = ref(false)
useTranscriptNav(list)

async function loadDetail(): Promise<void> {
  const sessionId = id.value
  const result = await window.api.sessions.get(sessionId)
  if (sessionId !== id.value) return
  detail.value = result.ok ? result.data : null
  ui.pageTitle = detail.value?.title ?? (incognito.value ? t('Incógnito') : null)
}

watch(
  id,
  (sessionId) => {
    detail.value = null
    scrolled.value = false
    fold.setAll(false)
    void loadDetail()
    void transcript.open(sessionId).then(reconcile)
    void chat.sync(sessionId)
  },
  { immediate: true }
)

/** Lo que ya está en disco sale de lo vivo (aquí y en el main), sin mover la lectura. */
function reconcile(): void {
  const state = live.value
  const p = transcript.payload
  if (!state || !p) return
  const known = diskIds(p.items)
  const onDisk = state.live.flatMap((i) => (i.uuid && known.has(i.uuid) ? [i.uuid] : []))
  if (onDisk.length > 0 || state.turnStartedAt === null) chat.reconciled(id.value, onDisk)
}

// Al terminar cada turno manda lo que hay en disco: se espera a la pasada del índice
// (la sesión nueva aún no estaba) y se relee con ancla, sin estado de carga.
watch(
  () => live.value?.turnEnds,
  async (now, before) => {
    if (!now || now === before || incognito.value) return
    await window.api.index.refresh()
    if (transcript.state === 'ready') await transcript.reload()
    else await transcript.open(id.value)
    reconcile()
    void loadDetail()
  }
)
// Una pasada del índice que cambia la lista recarga la ficha.
watch(
  () => sessions.items,
  () => void loadDetail()
)

// Lo nuevo de disco llega solo: se añade, se concilia con lo vivo del chat
// y se marca cuándo quedó pintado.
const stopAppended = window.api.sessions.onAppended((event) => {
  if (!transcript.append(event)) return
  reconcile()
  void nextTick(() =>
    requestAnimationFrame(() =>
      performance.mark('bitacora:vivo-pintado', {
        detail: { writtenAt: event.writtenAt, ms: Date.now() - event.writtenAt }
      })
    )
  )
})
onBeforeUnmount(() => {
  stopAppended()
  void window.api.sessions.follow(null)
  ui.pageTitle = null
  transcript.close()
})

function openContinuation(): void {
  const target = transcript.continuedIn
  if (target) void router.push({ name: 'session', params: { id: target } })
}

// --- Salto a un mensaje y resaltado ---------------------------------

/** `uuid` que se muestran aunque los filtros los oculten, solo para el salto actual. */
const reveal = ref<ReadonlySet<string>>(new Set())
/** Términos normalizados a resaltar y bloque de la coincidencia actual. */
const highlight = ref<string[]>([])
const currentKey = ref<string | null>(null)
const jumpNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
watch(id, () => {
  reveal.value = new Set()
  highlight.value = []
  currentKey.value = null
})

/**
 * Lleva al elemento `uuid`: lo revela, despliega su bloque (y la llamada, si es una salida de
 * herramienta) y lo centra. `false` si ya no está en la sesión.
 */
async function jumpTo(
  uuid: string,
  opts: { toolUseId?: string; prefer?: BlockKind } = {}
): Promise<boolean> {
  if (!reveal.value.has(uuid)) reveal.value = new Set([...reveal.value, uuid])
  await nextTick()
  const block: Block | null = blockOfUuid(blocks.value, uuid, opts)
  if (!block) return false
  fold.set(block.key, true)
  if (opts.toolUseId && block.kind === 'tools') fold.set(`${block.key}/${opts.toolUseId}`, true)
  const step = thinkingStepOf(block, uuid)
  if (step) fold.set(`${block.key}/${step}`, true)
  currentKey.value = block.key
  return (await list.value?.revealBlock(block.key)) ?? false
}

function showNotice(text: string): void {
  jumpNotice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (jumpNotice.value = null), 4000)
}
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
})

// Llegada desde la búsqueda global con `?m=<uuid>&q=<texto>`.
watch(
  () => [transcript.state, route.query['m'], list.value] as const,
  async ([state, m]) => {
    if (state !== 'ready' || typeof m !== 'string' || !m || !list.value) return
    const q = typeof route.query['q'] === 'string' ? route.query['q'] : ''
    highlight.value = q.replace(/"/g, ' ').split(/\s+/).filter(Boolean).map(normalizeForSearch)
    // Se limpia la URL: una recarga no vuelve a saltar.
    void router.replace({ name: 'session', params: { id: id.value } })
    const found = await jumpTo(m, { prefer: 'assistant' })
    if (!found) {
      list.value?.scrollToEnd()
      showNotice(t('El mensaje ya no está en la sesión'))
    }
  },
  { immediate: true }
)

// --- Buscar en la sesión: `Ctrl+F` ----------------------------------

const findOpen = ref(false)
const findQuery = ref('')
const findBar = ref<InstanceType<typeof FindBar> | null>(null)
/** Aparición actual por identidad estable: llegar elementos no mueve la lectura. */
const findCurrent = ref<string | null>(null)
watch(id, () => {
  findOpen.value = false
  findQuery.value = ''
  findCurrent.value = null
})

const findHits = computed<FindHit[]>(() => {
  if (!findOpen.value || !findQuery.value.trim()) return []
  const p = transcript.payload
  const started = performance.now()
  const hits = findInItems(mergeLive(p?.items ?? [], live.value?.live ?? []), findQuery.value)
  performance.mark('bitacora:buscar-en-sesion', {
    detail: { ms: performance.now() - started, hits: hits.length }
  })
  return hits
})
const findPosition = computed(() => {
  const at = findHits.value.findIndex((h) => hitId(h) === findCurrent.value)
  return at === -1 ? 0 : at + 1
})

async function findGo(delta: 1 | -1): Promise<void> {
  const hits = findHits.value
  if (hits.length === 0) return
  const from = findPosition.value - 1
  const next = from === -1 ? (delta === 1 ? 0 : hits.length - 1) : from + delta
  const hit = hits[(next + hits.length) % hits.length] as FindHit
  findCurrent.value = hitId(hit)
  if (!hit.uuid) return
  const prefer =
    hit.field === 'thinking' ? 'thinking' : hit.field === 'prompt' ? 'user' : 'assistant'
  await jumpTo(hit.uuid, { prefer, ...(hit.toolUseId ? { toolUseId: hit.toolUseId } : {}) })
}

// Escribir lleva a la primera aparición; sin consulta no se resalta nada.
watch(findQuery, (q) => {
  findCurrent.value = null
  highlight.value = q.trim() ? [normalizeForSearch(q.trim())] : []
  if (q.trim()) void findGo(1)
})

function openFind(): void {
  if (document.querySelector('[role=dialog],[role=alertdialog]')) return
  if (transcript.state !== 'ready') return
  findOpen.value = true
  void nextTick(() => findBar.value?.focus())
}
function closeFind(): void {
  findOpen.value = false
  highlight.value = []
  currentKey.value = null
  list.value?.focus()
}
useShortcut('ctrl+f', openFind)

const blocks = computed(() => {
  const p = transcript.payload
  const state = live.value
  if (!p && !state) return []
  const items = mergeLive(p?.items ?? [], state?.live ?? [])
  const pending = chat.pendingOf(id.value)
  return buildBlocks(items, {
    ...(p ? { segments: p.segments } : {}),
    filters: ui.viewer,
    ...(reveal.value.size > 0 ? { reveal: reveal.value } : {}),
    ...(state || pending.length > 0
      ? {
          live: {
            running: working.value,
            progress: state?.progress ?? {},
            decisions: state?.decisions ?? {},
            draft: state?.draft ?? null,
            pending
          }
        }
      : {})
  })
})

// --- Compositor (bajo el transcript de toda sesión abierta) --------------------------

const draft = computed({
  get: () => chat.drafts.get(id.value) ?? '',
  set: (value: string) => void chat.drafts.set(id.value, value)
})
const attachments = computed({
  get: () => chat.draftAttachments.get(id.value) ?? [],
  set: (value: ChatAttachment[]) => void chat.draftAttachments.set(id.value, value)
})
/** Modelo y modo elegidos antes de reanudar una sesión inactiva: se aplican al enviar. */
const pendingModel = ref<string | null | undefined>(undefined)
const pendingMode = ref<ChatMode | undefined>(undefined)
const sendError = ref<string | null>(null)
watch(id, () => {
  pendingModel.value = undefined
  pendingMode.value = undefined
  sendError.value = null
})

const model = computed<string | null>({
  get: () => (live.value ? live.value.model : (pendingModel.value ?? null)),
  set: (value) => {
    void ui.setChat({ model: value })
    if (live.value) void chat.setModel(id.value, value)
    else pendingModel.value = value
  }
})
const mode = computed<ChatMode>({
  get: () => live.value?.mode ?? pendingMode.value ?? 'default',
  set: (value) => {
    if (value !== 'bypassPermissions') void ui.setChat({ permissionMode: value })
    if (live.value) void chat.setMode(id.value, value).then(toastError)
    else pendingMode.value = value
  }
})

// --- Comandos `/` y Claude en Chrome ----------------------------------------------

const commands = computed(() =>
  slashEntries(live.value?.commands.length ? live.value.commands : chat.catalog.commands)
)
const host = ref<InstanceType<typeof SlashCommandHost> | null>(null)
/** Elegido antes de reanudar una sesión inactiva: va con el mensaje. */
const pendingChrome = ref<boolean | null>(null)
watch(id, () => (pendingChrome.value = null))
const chrome = computed<ChromeState>(() => {
  if (live.value && live.value.status !== 'closed') return live.value.chrome
  const enabled = pendingChrome.value ?? live.value?.chrome.enabled ?? false
  return enabled ? { enabled, status: 'pending' } : { enabled, status: 'off' }
})

function setChrome(enabled: boolean): void {
  if (live.value && live.value.status !== 'closed')
    void chat.setChrome(id.value, enabled).then(toastError)
  else pendingChrome.value = enabled
}

/** Cambio rechazado por el main (p. ej. el que haría perder una sesión de incógnito). */
function toastError(result: { ok: true } | { ok: false; error: { message: string } }): void {
  if (!result.ok) ui.toast(result.error.message, { tone: 'danger' })
}

function onPlan(text: string): void {
  mode.value = 'plan'
  if (text) void send(text, false, [])
}

/** `/copy`: la última respuesta de Claude (sus textos tras el último mensaje del usuario). */
async function copyLastResponse(): Promise<void> {
  const items = mergeLive(transcript.payload?.items ?? [], live.value?.live ?? [])
  const parts: string[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item || item.sidechain) continue
    if (item.kind === 'user-prompt') break
    if (item.kind === 'assistant-text' && item.text.trim()) parts.unshift(item.text.trim())
  }
  if (parts.length === 0) return ui.toast(t('Claude aún no ha respondido en esta sesión.'))
  try {
    await navigator.clipboard.writeText(parts.join('\n\n'))
    ui.toast(t('Última respuesta copiada'))
  } catch {
    ui.toast(t('No se pudo copiar'), { tone: 'danger' })
  }
}

/** Mensaje de la cola que se está editando en el compositor. */
const editingQueued = ref<string | null>(null)
watch(id, () => (editingQueued.value = null))

function editQueued(uuid: string): void {
  const item = live.value?.queue.find((q) => q.uuid === uuid)
  if (!item) return
  editingQueued.value = uuid
  draft.value = item.text
}

async function send(text: string, now: boolean, files: ChatAttachment[]): Promise<void> {
  sendError.value = null
  const editing = editingQueued.value
  if (editing) {
    editingQueued.value = null
    const still = live.value?.queue.some((q) => q.uuid === editing && q.state === 'queued')
    if (still) {
      await chat.queueEdit(id.value, editing, text)
      if (now) await chat.queueSendNow(id.value, editing)
      return
    }
  }
  if (files.length === 0 && host.value?.run(text)) return
  const wasActive = live.value !== null
  const result = await chat.send(
    id.value,
    text,
    now,
    files,
    pendingChrome.value !== null ? { chrome: pendingChrome.value } : {}
  )
  pendingChrome.value = null
  if (!result.ok) {
    // El texto y los adjuntos no se pierden.
    draft.value = text
    attachments.value = files
    sendError.value = result.error.message
    return
  }
  if (!wasActive) {
    if (pendingModel.value !== undefined) void chat.setModel(id.value, pendingModel.value)
    if (pendingMode.value !== undefined) void chat.setMode(id.value, pendingMode.value)
    pendingModel.value = undefined
    pendingMode.value = undefined
  }
}

// --- Permisos y preguntas ----------------------------------------------------

function respond(
  requestId: string,
  decision: 'allow' | 'always' | 'all' | 'deny',
  extra: { scope?: 'session' | 'project'; message?: string; answers?: Record<string, string> } = {}
): void {
  void chat.respond({
    sessionId: id.value,
    requestId,
    decision,
    ...(extra.scope ? { scope: extra.scope } : {}),
    ...(extra.message ? { message: extra.message } : {}),
    ...(extra.answers ? { answers: extra.answers } : {})
  })
}

function stop(): void {
  if (working.value) void chat.interrupt(id.value)
}

// `Esc` detiene la sesión visible si nadie más lo ha usado (menús, diálogos, tarjetas).
function onGlobalEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[role=dialog],[role=alertdialog],[role=menu],input,select')) return
  if (!working.value) return
  event.preventDefault()
  stop()
}
onMounted(() => window.addEventListener('keydown', onGlobalEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalEscape))

/** Lo que va tras los bloques: el transcript lo sigue si se estaba al final. */
const tail = computed(() => {
  const s = live.value
  return s ? `${s.permissions.length}:${s.error ? 1 : 0}:${activityRow.value ? 1 : 0}` : ''
})

/** Sesión nueva que aún no está en el índice, o de incógnito: se ve solo lo vivo. */
const liveOnly = computed(
  () =>
    incognito.value ||
    (transcript.state === 'missing' && live.value !== null && live.value.live.length > 0)
)

/** Marca de rendimiento: el final del transcript ya está pintado. */
function onPainted(): void {
  performance.mark('bitacora:transcript-pintado')
}

async function setFavorite(value: boolean): Promise<void> {
  await sessions.update(id.value, { favorite: value })
  await loadDetail()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <IncognitoHeader v-if="incognito" :scrolled="scrolled" :activity="activity">
      <template #actions>
        <IconButton
          :icon="PanelRight"
          :label="
            filesOpen ? t('Cerrar el panel de archivos') : t('Archivos ({n})', { n: files.length })
          "
          :aria-pressed="filesOpen"
          :class="filesOpen ? 'text-text' : ''"
          @click="filesOpen = !filesOpen"
        />
      </template>
    </IncognitoHeader>
    <TranscriptHeader
      v-else-if="detail"
      :detail="detail"
      :chat-status="live?.status ?? null"
      :chat-activity="activity"
      :viewer="ui.viewer"
      :invalid-lines="transcript.payload?.invalidLines"
      :scrolled="scrolled"
      @favorite="setFavorite"
      @viewer="ui.setViewer"
      @fold-all="fold.setAll"
    >
      <template #actions>
        <IconButton
          :icon="PanelRight"
          :label="
            filesOpen ? t('Cerrar el panel de archivos') : t('Archivos ({n})', { n: files.length })
          "
          :aria-pressed="filesOpen"
          :class="filesOpen ? 'text-text' : ''"
          @click="filesOpen = !filesOpen"
        />
      </template>
      <template #menu>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <IconButton :icon="Ellipsis" :label="t('Más acciones')" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              align="end"
              :side-offset="4"
              :collision-padding="8"
              class="z-30 min-w-56 rounded-menu bg-surface p-1 text-text shadow-float"
            >
              <SessionMenu
                kind="dropdown"
                :session-id="detail.sessionId"
                :title="detail.title"
                :favorite="detail.favorite"
                :hidden="detail.hidden"
                @changed="loadDetail"
              />
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </template>
    </TranscriptHeader>

    <div ref="row" class="relative flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="relative flex min-h-0 flex-1 flex-col">
          <!-- Flotante: aparecer no mueve lo que se está leyendo. -->
          <div
            v-if="transcript.continuedIn && transcript.continuedIn !== id"
            class="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface px-4 py-1.5 text-sm whitespace-nowrap shadow-float"
            role="status"
          >
            <span class="text-muted">{{ t('La conversación sigue en otra sesión') }}</span>
            <span class="text-muted" aria-hidden="true">·</span>
            <button
              type="button"
              class="rounded-item px-1.5 font-medium text-accent hover:text-accent-hover"
              @click="openContinuation"
            >
              {{ t('Abrir') }}
            </button>
          </div>

          <FindBar
            v-if="findOpen"
            ref="findBar"
            v-model="findQuery"
            :current="findPosition"
            :total="findHits.length"
            @next="findGo(1)"
            @previous="findGo(-1)"
            @close="closeFind"
          />
          <div
            v-if="jumpNotice"
            class="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface px-4 py-1.5 text-sm whitespace-nowrap text-muted shadow-float"
            role="status"
          >
            {{ jumpNotice }}
          </div>

          <!-- Cargando: esqueleto de tres bloques. -->
          <div
            v-if="(transcript.state === 'loading' || transcript.state === 'idle') && !liveOnly"
            class="mx-auto flex w-full max-w-chat flex-col gap-6 px-6 py-8"
            aria-busy="true"
            :aria-label="t('Cargando la sesión')"
          >
            <div class="ml-auto h-12 w-2/3 animate-pulse rounded-bubble bg-surface-hover" />
            <div class="h-24 w-full animate-pulse rounded-item bg-surface-hover" />
            <div class="h-6 w-1/2 animate-pulse rounded-item bg-surface-hover" />
          </div>

          <div
            v-else-if="transcript.state === 'missing' && !liveOnly"
            class="mx-auto flex w-full max-w-chat flex-col gap-2 px-6 py-8"
          >
            <h2 class="font-serif text-2xl">{{ t('Esta sesión ya no existe.') }}</h2>
            <p class="text-muted">
              {{ t('Puede que se haya borrado de la carpeta de Claude Code.') }}
              <RouterLink to="/" class="text-text underline underline-offset-2">{{
                t('Volver al inicio')
              }}</RouterLink
              >.
            </p>
          </div>

          <div
            v-else-if="transcript.state === 'error' && !incognito"
            class="mx-auto flex w-full max-w-chat flex-col items-start gap-3 px-6 py-8"
            role="alert"
          >
            <p class="text-danger">
              {{ t('No se pudo leer la sesión: {error}', { error: transcript.error ?? '' }) }}
            </p>
            <button
              type="button"
              class="rounded-item border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
              @click="transcript.open(id)"
            >
              {{ t('Reintentar') }}
            </button>
          </div>

          <p v-else-if="blocks.length === 0" class="mx-auto w-full max-w-chat px-6 py-8 text-muted">
            {{ t('No hay nada que mostrar con los filtros actuales.') }}
          </p>

          <TranscriptList
            v-else
            ref="list"
            :blocks="blocks"
            :list-key="transcript.payload?.sessionId ?? id"
            :cwd="transcript.payload?.cwd ?? live?.cwd"
            :session-id="id"
            :tail="tail"
            :highlight="highlight"
            :current-key="currentKey"
            :word-start="!findOpen"
            @painted="onPainted"
            @scrolled="scrolled = $event"
          >
            <template
              v-if="live && (live.error || live.permissions.length > 0 || activityRow)"
              #footer
            >
              <ActivityRow
                v-if="activityRow && activity"
                :label="activity"
                :started-at="live.turnStartedAt"
              />
              <!-- Las peticiones pendientes, al final y en orden de llegada. -->
              <template v-for="(request, index) in live.permissions" :key="request.requestId">
                <QuestionCard
                  v-if="request.kind === 'question'"
                  :request="request"
                  @answer="respond(request.requestId, 'allow', { answers: $event })"
                  @skip="respond(request.requestId, 'deny')"
                />
                <PlanCard
                  v-else-if="request.kind === 'plan'"
                  :request="request"
                  @approve="respond(request.requestId, 'allow')"
                  @keep-planning="respond(request.requestId, 'deny', { message: $event })"
                />
                <PermissionCard
                  v-else
                  :request="request"
                  :cwd="transcript.payload?.cwd ?? live.cwd"
                  :autofocus="index === 0 && draft.trim() === ''"
                  @allow="respond(request.requestId, 'allow')"
                  @always="respond(request.requestId, 'always', { scope: $event })"
                  @all="respond(request.requestId, 'all')"
                  @deny="respond(request.requestId, 'deny', { message: $event })"
                />
              </template>
              <RateLimitNotice v-if="live.rateLimit" :window="live.rateLimit" />
              <ChatErrorNotice
                v-if="live.error && !(live.rateLimit?.status === 'rejected')"
                :error="live.error"
                @dismiss="chat.clearError(id)"
              />
            </template>
          </TranscriptList>
        </div>

        <div class="mx-auto w-full max-w-chat shrink-0 px-6 pb-4">
          <p v-if="sendError" class="mb-2 text-sm text-danger" role="alert">{{ sendError }}</p>
          <Composer
            v-model="draft"
            v-model:attachments="attachments"
            v-model:model="model"
            v-model:mode="mode"
            :no-attach="editingQueued !== null"
            :working="working"
            :models="chat.catalog.models"
            :commands="commands"
            :mentions="{ sessionId: id }"
            :incognito="incognito"
            :placeholder="working ? t('Escribe para ponerlo en cola…') : t('Responder…')"
            @send="send"
            @stop="stop"
          >
            <template #tools>
              <ChromeChip v-if="chrome.enabled" :chrome="chrome" @open="host?.openChrome()" />
            </template>
            <template #above>
              <BackgroundTasks
                v-if="live"
                :tasks="live.tasks"
                @stop="chat.stopTask(id, $event)"
                @open="jumpToTool"
              />
              <QueuedChips
                v-if="live"
                :queue="live.queue.filter((q) => q.state === 'queued')"
                :editing="editingQueued"
                @edit="editQueued"
                @remove="chat.queueRemove(id, $event)"
                @send-now="chat.queueSendNow(id, $event)"
              />
            </template>
          </Composer>
          <SlashCommandHost
            ref="host"
            :session-id="id"
            :incognito="incognito"
            :cwd="transcript.payload?.cwd ?? live?.cwd ?? null"
            :commands="commands"
            :chrome="chrome"
            @chrome="setChrome"
            @plan="onPlan"
            @copy="copyLastResponse"
            @files="filesOpen = true"
            @insert="draft = $event"
          />
        </div>
      </div>
      <FilesPanel
        v-if="filesOpen"
        :files="files"
        :session-id="id"
        :cwd="transcript.payload?.cwd ?? live?.cwd"
        :class="overlay ? 'absolute inset-y-0 right-0 z-20 shadow-float' : ''"
        @close="filesOpen = false"
      />
    </div>
  </div>
</template>
