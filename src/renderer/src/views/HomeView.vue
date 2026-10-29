<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref, watch } from 'vue'
import type { ChatAttachment, ChatMode, ChromeState } from '../../../shared/chat'
import { effective, type ProjectSettings } from '../../../shared/project-settings'
import ChromeChip from '../components/commands/ChromeChip.vue'
import SlashCommandHost from '../components/commands/SlashCommandHost.vue'
import { slashEntries } from '../lib/slash-commands'
import { imageCount } from '../lib/attachments'
import { useRouter } from 'vue-router'
import Composer from '../components/chat/Composer.vue'
import UserMessage from '../components/chat/UserMessage.vue'
import WelcomeHero from '../components/chat/WelcomeHero.vue'
import WorkdirChip from '../components/chat/WorkdirChip.vue'
import { NEW_DRAFT, useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useUiStore } from '../stores/ui'

/**
 * Sesión nueva: bienvenida, compositor y carpeta de trabajo (la del proyecto
 * activo). Al enviar arranca Claude Code y, en cuanto se conoce el id, pasa a la vista de la
 * sesión, que sigue mostrando la respuesta en streaming.
 */
const chat = useChatStore()
const projects = useProjectsStore()
const ui = useUiStore()
const router = useRouter()

const cwd = ref<string | null>(projects.active?.path ?? null)
/** Modelo y modo de la sesión nueva: la última elección; «Saltar permisos» no se guarda. */
const model = computed<string | null>({
  get: () => ui.chat.model,
  set: (value) => void ui.setChat({ model: value })
})
watch(
  () => projects.active?.path,
  (path) => {
    if (path && !pending.value) cwd.value = path
  }
)

/** Ajustes del proyecto de la carpeta: su modo y Claude en Chrome. */
const projectSettings = ref<ProjectSettings | null>(null)
/** Elegidos aquí: mandan sobre los del proyecto hasta cambiar de carpeta. */
const picked = ref<ChatMode | null>(null)
const chromeOverride = ref<boolean | null>(null)
watch(
  () => [projects.active?.id, cwd.value] as const,
  async ([projectId, folder]) => {
    projectSettings.value = null
    picked.value = null
    chromeOverride.value = null
    if (!projectId || !folder || folder !== projects.active?.path) return
    const result = await window.api.projectSettings.read(projectId)
    if (result.ok && projectId === projects.active?.id) projectSettings.value = result.data
  },
  { immediate: true }
)

const SAVED_MODES: string[] = ['default', 'acceptEdits', 'plan']
const projectMode = computed<ChatMode | null>(() => {
  const s = projectSettings.value
  const mode = s ? effective(s, (l) => l.defaultMode) : null
  return mode && SAVED_MODES.includes(mode) ? (mode as ChatMode) : null
})
const mode = computed<ChatMode>({
  get: () => picked.value ?? projectMode.value ?? ui.chat.permissionMode,
  set: (value) => {
    picked.value = value
    if (value !== 'bypassPermissions') void ui.setChat({ permissionMode: value })
  }
})

const chrome = computed<ChromeState>(() => {
  const enabled = chromeOverride.value ?? projectSettings.value?.chrome ?? false
  return enabled ? { enabled, status: 'pending' } : { enabled, status: 'off' }
})

const commands = computed(() => slashEntries(chat.catalog.commands))
const host = ref<InstanceType<typeof SlashCommandHost> | null>(null)

function onPlan(text: string): void {
  mode.value = 'plan'
  if (text) void send(text, false, [])
}

const draft = computed({
  get: () => chat.drafts.get(NEW_DRAFT) ?? '',
  set: (value: string) => void chat.drafts.set(NEW_DRAFT, value)
})
const attachments = computed({
  get: () => chat.draftAttachments.get(NEW_DRAFT) ?? [],
  set: (value: ChatAttachment[]) => void chat.draftAttachments.set(NEW_DRAFT, value)
})

/** Mensaje enviado mientras arranca Claude Code. */
const pending = ref<{
  text: string
  attachments: ChatAttachment[]
  chatId: string | null
} | null>(null)
const error = ref<string | null>(null)

async function pickFolder(): Promise<void> {
  const result = await window.api.system.pickFolder()
  if (result.ok && result.data) cwd.value = result.data
}

async function send(text: string, _now: boolean, files: ChatAttachment[]): Promise<void> {
  if (!cwd.value || pending.value) return
  if (files.length === 0 && host.value?.run(text)) return
  error.value = null
  pending.value = { text, attachments: files, chatId: null }
  const result = await chat.start({
    cwd: cwd.value,
    text,
    ...(files.length > 0 ? { attachments: files } : {}),
    model: model.value,
    mode: mode.value,
    ...(chromeOverride.value !== null ? { chrome: chromeOverride.value } : {})
  })
  if (!result.ok) {
    // El texto y los adjuntos no se pierden.
    pending.value = null
    draft.value = text
    attachments.value = files
    error.value = result.error.message
    return
  }
  pending.value = { text, attachments: files, chatId: result.chatId }
}

const started = computed(() =>
  pending.value?.chatId ? (chat.sessions.get(pending.value.chatId) ?? null) : null
)

// Con el id de la sesión, a su vista. Si falla antes, el error se ve aquí.
watch(
  () => [started.value?.sessionId, started.value?.error] as const,
  ([sessionId, startError]) => {
    if (sessionId) {
      draft.value = ''
      void router.replace(`/sesion/${sessionId}`)
    } else if (startError && pending.value) {
      draft.value = pending.value.text
      attachments.value = pending.value.attachments
      error.value = startError.message
      pending.value = null
    }
  }
)
</script>

<template>
  <!-- Bienvenida: saludo, compositor y carpeta de trabajo centrados. -->
  <div class="flex h-full flex-col items-center justify-center px-6 pb-16">
    <div class="flex w-full max-w-chat flex-col items-center gap-8">
      <WelcomeHero v-if="!pending" />
      <div v-else class="flex w-full flex-col gap-3">
        <UserMessage :text="pending.text" :images="imageCount(pending.attachments)" pending />
        <p class="text-sm text-muted" role="status">{{ t('Iniciando Claude Code…') }}</p>
      </div>
      <Composer
        v-model="draft"
        v-model:attachments="attachments"
        v-model:model="model"
        v-model:mode="mode"
        :models="chat.catalog.models"
        :commands="commands"
        :mentions="cwd ? { cwd } : null"
        :disabled="!cwd || pending !== null"
        :placeholder="cwd ? t('¿En qué puedo ayudarte?') : t('Elige antes una carpeta de trabajo')"
        @send="send"
      >
        <template #tools>
          <ChromeChip v-if="chrome.enabled" :chrome="chrome" @open="host?.openChrome()" />
        </template>
      </Composer>
      <p v-if="error" class="-mt-4 w-full text-sm text-danger" role="alert">{{ error }}</p>
      <WorkdirChip v-model="cwd" class="-mt-4" :readonly="pending !== null" @pick="pickFolder" />
      <SlashCommandHost
        ref="host"
        :session-id="null"
        :cwd="cwd"
        :commands="commands"
        :chrome="chrome"
        @chrome="chromeOverride = $event"
        @plan="onPlan"
        @insert="draft = $event"
      />
    </div>
  </div>
</template>
