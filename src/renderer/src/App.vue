<script setup lang="ts">
import { t } from './i18n'
import { TooltipProvider } from 'reka-ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CloseRequest } from '../../shared/chat'
import AppSidebar from './components/layout/AppSidebar.vue'
import MainHeader from './components/layout/MainHeader.vue'
import SearchDialog from './components/search/SearchDialog.vue'
import RenameSessionDialog from './components/sessions/RenameSessionDialog.vue'
import TrashSessionsDialog from './components/sessions/TrashSessionsDialog.vue'
import AboutDialog from './components/ui/AboutDialog.vue'
import AppToast from './components/ui/AppToast.vue'
import type { AppCommand } from '../../shared/types'
import ConfirmDialog from './components/ui/ConfirmDialog.vue'
import WelcomeScreen from './components/welcome/WelcomeScreen.vue'
import { useShortcut } from './composables/useShortcut'
import { useChatStore } from './stores/chat'
import { useGitStore } from './stores/git'
import { useTerminalStore } from './stores/terminal'
import { useProjectsStore } from './stores/projects'
import { useSearchStore } from './stores/search'
import { useSessionsStore } from './stores/sessions'
import { useUiStore } from './stores/ui'
import { useUpdateStore } from './stores/update'
import { useUsageStore } from './stores/usage'

const route = useRoute()
const ui = useUiStore()
const title = computed(() => ui.pageTitle ?? route.meta.title ?? 'OpenClod')

const projects = useProjectsStore()
const sessions = useSessionsStore()
const chat = useChatStore()

// Una sola suscripción a `index:updated` y otra a `chat:event` para toda la
// app: así se siguen todas las sesiones de chat aunque no se vean.
let unsubscribe: (() => void) | null = null
let unsubscribeChat: (() => void) | null = null
let unsubscribeClose: (() => void) | null = null
let unsubscribeLimits: (() => void) | null = null
let unsubscribeUpdate: (() => void) | null = null
const usage = useUsageStore()
const update = useUpdateStore()

/** Cerrar con sesiones trabajando o esperando permiso pide confirmación. */
const closing = ref<CloseRequest | null>(null)
const closeOpen = computed({
  get: () => closing.value !== null,
  set: (open: boolean) => {
    if (!open) closing.value = null
  }
})
const closeText = computed(() => {
  const c = closing.value
  if (!c) return ''
  const parts: string[] = []
  if (c.working)
    parts.push(
      c.working === 1 ? t('1 sesión trabajando') : t('{n} sesiones trabajando', { n: c.working })
    )
  if (c.waiting)
    parts.push(
      c.waiting === 1
        ? t('1 sesión esperando permiso')
        : t('{n} sesiones esperando permiso', { n: c.waiting })
    )
  if (c.terminals)
    parts.push(
      c.terminals === 1 ? t('1 terminal abierta') : t('{n} terminales abiertas', { n: c.terminals })
    )
  const list = parts.join(` ${t('y')} `)
  return c.restart
    ? t(
        'Hay {list}. Al reiniciar se detendrán; las sesiones podrás continuarlas cuando se abra la versión nueva.',
        { list }
      )
    : t(
        'Hay {list}. Al salir se detendrán; las sesiones podrás continuarlas al volver a abrir la app.',
        { list }
      )
})

function quit(): void {
  void window.api.app.quit(closing.value?.restart ?? false)
}

// `Ctrl+N`: sesión nueva.
const router = useRouter()
useShortcut('ctrl+n', () => void router.push('/'))
// `Ctrl+K`: búsqueda global, también con el foco en el compositor.
const search = useSearchStore()
useShortcut('ctrl+k', () => (search.open = true))
// `Ctrl+U`: vista Uso.
useShortcut('ctrl+u', () => void router.push('/uso'))
// `Ctrl+,`: Ajustes.
useShortcut('ctrl+,', () => void router.push('/ajustes'))

// `Ctrl+`` (la tecla a la izquierda del 1, sea cual sea su carácter): Terminal.
const onTerminalKey = (event: KeyboardEvent): void => {
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.code !== 'Backquote') return
  event.preventDefault()
  void router.push('/terminal')
}
const terminal = useTerminalStore()
const resumeOpen = computed({
  get: () => terminal.confirmResume !== null,
  set: (open: boolean) => {
    if (!open) terminal.confirmResume = null
  }
})
function confirmResume(): void {
  const id = terminal.confirmResume
  terminal.confirmResume = null
  if (id) void terminal.resume(id, true)
}

let unsubscribeCommand: (() => void) | null = null
function runCommand(command: AppCommand): void {
  switch (command) {
    case 'new-session':
      return void router.push('/')
    case 'open-project':
      return void projects.importFolder()
    case 'search':
      search.open = true
      return
    case 'usage':
      return void router.push('/uso')
    case 'terminal':
      return void router.push('/terminal')
    case 'settings':
      return void router.push('/ajustes')
    case 'diagnostics':
      return void router.push('/diagnostico')
    case 'about':
      ui.aboutOpen = true
      return
  }
}

// Git se refresca al volver el foco y tras cada pasada con cambios.
const git = useGitStore()
let unsubscribeNavigate: (() => void) | null = null
const onFocus = (): void => git.refresh()

onMounted(() => {
  unsubscribeClose = window.api.app.onCloseRequest((request) => (closing.value = request))
  // Notificación pulsada.
  unsubscribeNavigate = window.api.app.onNavigate(({ path }) => {
    if (path.startsWith('/')) void router.push(path)
  })
  // Menú nativo y bandeja: lo mismo que los atajos.
  unsubscribeCommand = window.api.app.onCommand(({ command }) => runCommand(command))
  window.addEventListener('focus', onFocus)
  window.addEventListener('keydown', onTerminalKey)
  unsubscribe = window.api.index.onUpdated((event) => {
    sessions.onIndexUpdated(event)
    usage.onIndexUpdated(event.changed)
    if (event.changed) git.refresh()
  })
  void usage.init().then((off) => (unsubscribeLimits = off))
  void sessions.loadStatus()
  void projects.load()
  void chat.init().then((off) => (unsubscribeChat = off))
  void update.init().then((off) => (unsubscribeUpdate = off))
})
onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeChat?.()
  unsubscribeClose?.()
  unsubscribeLimits?.()
  unsubscribeUpdate?.()
  unsubscribeNavigate?.()
  unsubscribeCommand?.()
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onTerminalKey)
})
</script>

<template>
  <TooltipProvider>
    <!-- Hasta leer los ajustes no se sabe si toca la bienvenida: no se pinta nada. -->
    <div v-if="!ui.settingsLoaded" class="h-full bg-bg" />
    <WelcomeScreen v-else-if="!ui.welcomed" />
    <div v-else class="flex h-full overflow-hidden">
      <AppSidebar />
      <div class="flex min-w-0 flex-1 flex-col bg-bg">
        <MainHeader :title="title" />
        <!-- `relative`: lo posicionado dentro (p. ej. tablas `sr-only`) se queda en este scroll. -->
        <main class="relative min-h-0 flex-1 overflow-y-auto">
          <RouterView />
        </main>
      </div>
    </div>
    <RenameSessionDialog />
    <TrashSessionsDialog />
    <SearchDialog />
    <AppToast />
    <AboutDialog v-model:open="ui.aboutOpen" />
    <ConfirmDialog
      v-model:open="resumeOpen"
      :title="t('¿Continuar en la terminal?')"
      :description="
        t(
          'La sesión está abierta en la app; escribir en los dos sitios a la vez mezclaría los mensajes. Se cerrará el chat de la app y se abrirá con claude --resume.'
        )
      "
      :confirm-label="t('Cerrar el chat y abrir')"
      @confirm="confirmResume"
    />
    <ConfirmDialog
      v-model:open="closeOpen"
      :title="closing?.restart ? t('¿Reiniciar para actualizar?') : t('¿Salir de OpenClod?')"
      :description="closeText"
      :confirm-label="closing?.restart ? t('Reiniciar') : t('Salir')"
      danger
      @confirm="quit"
    />
  </TooltipProvider>
</template>
