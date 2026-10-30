<script setup lang="ts">
import { t } from '../../i18n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ChromeState } from '../../../../shared/chat'
import { classifySlash, type AppCommandId, type SlashEntry } from '../../lib/slash-commands'
import { useChatStore } from '../../stores/chat'
import { useProjectsStore } from '../../stores/projects'
import { useSearchStore } from '../../stores/search'
import { useTabsStore } from '../../stores/tabs'
import { useTerminalStore } from '../../stores/terminal'
import { useUiStore } from '../../stores/ui'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import ChromeDialog from './ChromeDialog.vue'
import CommandsDialog from './CommandsDialog.vue'

/**
 * Comandos `/` que no ejecuta Claude Code: la vista le pasa cada
 * mensaje con `run(text)` antes de enviarlo; si es un comando de la app lo resuelve aquí (o avisa
 * a la vista con un evento) y si solo existe en la terminal ofrece abrirla. Devuelve `true` si el
 * mensaje no debe llegar a Claude.
 */
const props = defineProps<{
  /** `null` en una sesión nueva aún sin empezar. */
  sessionId: string | null
  cwd: string | null
  commands: SlashEntry[]
  chrome: ChromeState
  /** Sesión de incógnito: no está en disco, así que no se exporta ni se reanuda en la terminal. */
  incognito?: boolean
}>()

const emit = defineEmits<{
  /** Claude en Chrome de esta sesión. */
  chrome: [enabled: boolean]
  /** `/plan`: pasar a Planificar y, si hay texto, enviarlo. */
  plan: [text: string]
  copy: []
  files: []
  /** Escribir en el compositor (elegir un comando en `/help`). */
  insert: [text: string]
}>()

const router = useRouter()
const ui = useUiStore()
const chat = useChatStore()
const tabs = useTabsStore()
const projects = useProjectsStore()
const search = useSearchStore()
const terminal = useTerminalStore()

const keyOf = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
/** Proyecto importado de la carpeta de trabajo. */
const project = computed(() => {
  const cwd = props.cwd
  return cwd ? (projects.projects.find((p) => keyOf(p.path) === keyOf(cwd)) ?? null) : null
})

const catalog = computed(() => props.commands.filter((c) => c.source === 'claude'))

const helpOpen = ref(false)
const chromeOpen = ref(false)
const projectChrome = ref<boolean | null>(null)
const terminalCommand = ref<{ name: string; description: string } | null>(null)
const terminalOpen = computed({
  get: () => terminalCommand.value !== null,
  set: (value: boolean) => {
    if (!value) terminalCommand.value = null
  }
})

function needsProject(): string | null {
  if (project.value) return project.value.id
  ui.toast(t('Esta carpeta no es un proyecto importado: impórtala desde el selector de proyectos.'))
  return null
}

function needsSession(): string | null {
  if (props.sessionId) return props.sessionId
  ui.toast(t('Primero empieza la sesión enviando un mensaje.'))
  return null
}

async function openChrome(): Promise<void> {
  projectChrome.value = null
  chromeOpen.value = true
  if (!project.value) return
  const result = await window.api.projectSettings.read(project.value.id)
  projectChrome.value = result.ok ? result.data.chrome : false
}

async function setProjectChrome(enabled: boolean): Promise<void> {
  if (!project.value) return
  const result = await window.api.projectSettings.setChrome(project.value.id, enabled)
  if (!result.ok)
    return ui.toast(t('No se pudo guardar: {error}', { error: result.error.message }), {
      tone: 'danger'
    })
  projectChrome.value = enabled
  // Activarlo en el proyecto también lo activa aquí, y al revés.
  if (props.chrome.enabled !== enabled) emit('chrome', enabled)
}

async function exportSession(sessionId: string): Promise<void> {
  const result = await window.api.sessions.export({ sessionId, tools: false })
  if (!result.ok)
    return ui.toast(t('No se pudo exportar: {error}', { error: result.error.message }), {
      tone: 'danger'
    })
  const saved = result.data
  if (!saved) return
  ui.toast(t('Sesión exportada'), {
    action: {
      label: t('Mostrar en la carpeta'),
      run: () => void window.api.files.revealExport(saved.path)
    }
  })
}

/** Abre la sesión (o Claude Code, si aún no hay sesión) en la terminal integrada. */
async function openTerminal(command?: string): Promise<void> {
  if (props.incognito)
    return ui.toast(t('Las sesiones de incógnito no se pueden seguir en la terminal.'))
  if (props.sessionId) await terminal.resume(props.sessionId)
  else {
    const opened = await terminal.open(
      'claude',
      project.value ? { projectId: project.value.id } : undefined
    )
    if (opened) await router.push('/terminal')
  }
  if (command) ui.toast(t('Escribe /{command} en la terminal', { command }))
}

function runApp(id: AppCommandId, args: string): void {
  switch (id) {
    case 'chrome':
      void openChrome()
      return
    case 'permissions': {
      const projectId = needsProject()
      if (projectId) void router.push(`/proyecto/${projectId}/ajustes`)
      return
    }
    case 'memory': {
      const projectId = needsProject()
      if (projectId) void router.push(`/proyecto/${projectId}/instrucciones`)
      return
    }
    case 'resume':
      search.open = true
      return
    case 'help':
      helpOpen.value = true
      return
    case 'theme':
      void router.push('/ajustes')
      return
    case 'new':
      void router.push('/')
      return
    case 'plan':
      emit('plan', args)
      return
    case 'copy':
      emit('copy')
      return
    case 'files':
      emit('files')
      return
    case 'export': {
      if (props.incognito)
        return ui.toast(t('Las sesiones de incógnito no se guardan: no se pueden exportar.'))
      const sessionId = needsSession()
      if (sessionId) void exportSession(sessionId)
      return
    }
    case 'exit': {
      // De incógnito no hay nada que reanudar: salir es cerrar su pestaña (y borrarla).
      if (props.incognito) return tabs.closeActive()
      const sessionId = needsSession()
      if (!sessionId) return
      void chat.close(sessionId)
      ui.toast(t('Proceso de Claude Code cerrado: el siguiente mensaje lo vuelve a abrir.'))
      return
    }
    case 'terminal':
      void openTerminal()
      return
  }
}

function run(text: string): boolean {
  const action = classifySlash(text, catalog.value)
  if (action.kind === 'claude') return false
  if (action.kind === 'app') runApp(action.id, action.args)
  else terminalCommand.value = { name: action.name, description: action.description }
  return true
}

function pickFromHelp(name: string): void {
  emit('insert', `/${name} `)
}

defineExpose({ run, openChrome })
</script>

<template>
  <CommandsDialog v-model:open="helpOpen" :commands="commands" @pick="pickFromHelp" />
  <ChromeDialog
    v-model:open="chromeOpen"
    :chrome="chrome"
    :project="project ? (projectChrome ?? false) : null"
    :draft="sessionId === null"
    @session="emit('chrome', $event)"
    @project="setProjectChrome"
  />
  <ConfirmDialog
    v-model:open="terminalOpen"
    :title="t('/{command} necesita la terminal', { command: terminalCommand?.name ?? '' })"
    :description="
      t('{description}. Claude Code solo lo ofrece en su terminal interactiva: {next}', {
        description: terminalCommand?.description ?? '',
        next: sessionId
          ? t('puedes seguir esta sesión en la terminal integrada y volver después.')
          : t('puedes abrir Claude Code en la terminal integrada.')
      })
    "
    :confirm-label="t('Abrir en la terminal')"
    @confirm="openTerminal(terminalCommand?.name)"
  />
</template>
