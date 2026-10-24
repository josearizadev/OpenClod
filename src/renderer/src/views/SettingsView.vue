<script setup lang="ts">
import { t } from '../i18n'
import { FolderOpen, LogIn, RefreshCw, RotateCcw } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { TerminalShells } from '../../../shared/terminal'
import type { Language } from '../../../shared/i18n'
import type { NotificationSettings, SystemInfo } from '../../../shared/types'
import SettingRow from '../components/settings/SettingRow.vue'
import SettingSwitch from '../components/settings/SettingSwitch.vue'
import ThemeToggle from '../components/ui/ThemeToggle.vue'
import { useAuthStore } from '../stores/auth'
import { useTerminalStore } from '../stores/terminal'
import { useUiStore } from '../stores/ui'
import { useUsageStore } from '../stores/usage'

/**
 * Ajustes: cada cambio se guarda al momento en
 * `state.json` a través del main.
 */
const ui = useUiStore()
const usage = useUsageStore()
const auth = useAuthStore()
const terminals = useTerminalStore()

/** Los nombres de los idiomas van en su propio idioma. */
const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'system', label: t('Sistema') },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' }
]

const accountText = computed(() => {
  const s = auth.status
  if (!s) return t('Comprobando…')
  if (s.state === 'out') return t('Sin sesión iniciada')
  if (s.state === 'unknown') return t('No se pudo comprobar')
  const plan = s.plan
    ? t('Plan {plan}', { plan: s.plan.charAt(0).toUpperCase() + s.plan.slice(1) })
    : ''
  return [s.email ?? t('Sesión iniciada'), plan].filter(Boolean).join(' · ')
})

const info = ref<SystemInfo | null>(null)
const claude = ref<{ dir: string; source: 'settings' | 'env' | 'default' } | null>(null)
const claudeError = ref<string | null>(null)

const SOURCES = {
  settings: t('Elegida en Ajustes'),
  env: t('Variable CLAUDE_CONFIG_DIR'),
  default: t('Predeterminada')
} as const

async function loadClaude(): Promise<void> {
  const result = await window.api.claude.dir()
  if (result.ok) claude.value = result.data
}

const shells = ref<TerminalShells | null>(null)
const defaultShellLabel = computed(
  () => shells.value?.available.find((s) => s.id === shells.value?.default)?.label ?? '—'
)

onMounted(async () => {
  await ui.loadSettings()
  void auth.refresh()
  void loadClaude()
  void window.api.terminal.shells().then((r) => (shells.value = r.ok ? r.data : null))
  const result = await window.api.system.info()
  if (result.ok) info.value = result.data
})

async function setClaudeDir(dir: string | null): Promise<void> {
  claudeError.value = null
  const result = await window.api.settings.set({ claudeDir: dir })
  if (!result.ok) claudeError.value = result.error.message
  await loadClaude()
}

async function pickClaudeDir(): Promise<void> {
  const picked = await window.api.system.pickFolder('claudeDir')
  if (picked.ok && picked.data) await setClaudeDir(picked.data)
}

const notify = computed(() => ui.notifications)
function setNotify(key: keyof NotificationSettings, value: boolean): void {
  void ui.setNotifications({ [key]: value })
}

const kinds = [
  {
    key: 'turnEnd',
    label: t('Al terminar'),
    description: t('Claude ha terminado un turno o ha fallado.')
  },
  {
    key: 'permission',
    label: t('Permisos y preguntas'),
    description: t('Claude espera tu respuesta.')
  },
  {
    key: 'tasks',
    label: t('Tareas en segundo plano'),
    description: t('Una tarea termina o falla.')
  },
  { key: 'limit', label: t('Límite de uso'), description: t('Se alcanza el límite de 5 horas.') }
] as const

const versions = computed(() => {
  const i = info.value
  if (!i) return []
  return [
    ['OpenClod', i.app],
    [t('Claude Code (incluido)'), i.claudeCode ?? '—'],
    ['Electron', i.electron],
    ['Chromium', i.chrome],
    ['Node.js', i.node],
    ['Git', i.git ?? t('No encontrado')]
  ]
})

const sectionTitle = 'mb-1 font-serif text-lg'
const section = 'divide-y divide-border rounded-item border border-border bg-surface px-4'
</script>

<template>
  <div class="mx-auto flex w-full max-w-[40rem] flex-col gap-8 px-6 py-8">
    <section aria-labelledby="ajustes-general">
      <h2 id="ajustes-general" :class="sectionTitle">{{ t('General') }}</h2>
      <div :class="section">
        <SettingRow
          :label="t('Idioma')"
          :description="t('La ventana se recarga al cambiarlo; los chats siguen abiertos.')"
          for="settings-language"
        >
          <select
            id="settings-language"
            :value="ui.language"
            class="h-8 rounded-item border border-border bg-surface px-2 text-sm"
            @change="ui.setLanguage(($event.target as HTMLSelectElement).value as Language)"
          >
            <option v-for="option in LANGUAGES" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </SettingRow>
        <SettingRow :label="t('Cuenta de Claude Code')" :description="accountText">
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-item text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
            :title="t('Comprobar de nuevo')"
            :aria-label="t('Comprobar de nuevo')"
            :disabled="auth.checking"
            @click="auth.refresh()"
          >
            <RefreshCw
              :size="16"
              :stroke-width="1.75"
              :class="auth.checking ? 'motion-safe:animate-spin' : ''"
              aria-hidden="true"
            />
          </button>
          <button
            v-if="auth.status && auth.status.state !== 'in'"
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover"
            @click="terminals.login()"
          >
            <LogIn :size="16" :stroke-width="1.75" aria-hidden="true" />
            {{ t('Iniciar sesión') }}
          </button>
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-apariencia">
      <h2 id="ajustes-apariencia" :class="sectionTitle">{{ t('Apariencia') }}</h2>
      <div :class="section">
        <SettingRow :label="t('Tema')" :description="t('Claro, oscuro o el del sistema.')">
          <ThemeToggle />
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-claude">
      <h2 id="ajustes-claude" :class="sectionTitle">Claude Code</h2>
      <div :class="section">
        <SettingRow
          :label="t('Carpeta de datos')"
          :description="claude ? SOURCES[claude.source] : ''"
        >
          <template #extra>
            <p class="mt-1 truncate font-mono text-xs" :title="claude?.dir">{{ claude?.dir }}</p>
            <p v-if="claudeError" class="mt-1 text-xs text-danger" role="alert">
              {{ claudeError }}
            </p>
          </template>
          <button
            v-if="claude?.source === 'settings'"
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item px-2 text-sm hover:bg-surface-hover"
            :title="t('Volver a la predeterminada')"
            @click="setClaudeDir(null)"
          >
            <RotateCcw :size="16" :stroke-width="1.75" aria-hidden="true" />
            {{ t('Predeterminada') }}
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item border border-border px-3 text-sm hover:bg-surface-hover"
            @click="pickClaudeDir"
          >
            <FolderOpen :size="16" :stroke-width="1.75" aria-hidden="true" />
            {{ t('Elegir otra…') }}
          </button>
        </SettingRow>
      </div>
      <p class="mt-1 text-xs text-muted">
        {{ t('OpenClod solo lee esta carpeta; las sesiones las escribe Claude Code.') }}
      </p>
    </section>

    <section aria-labelledby="ajustes-terminal">
      <h2 id="ajustes-terminal" :class="sectionTitle">{{ t('Terminal') }}</h2>
      <div :class="section">
        <SettingRow
          :label="t('Shell')"
          :description="
            shells?.error
              ? t('No disponible: {error}', { error: shells.error })
              : t('Se usa al abrir terminales nuevas.')
          "
          for="terminal-shell"
        >
          <select
            id="terminal-shell"
            :value="ui.terminal.shell ?? ''"
            :disabled="!shells || !!shells.error"
            class="h-8 rounded-item border border-border bg-surface px-2 text-sm"
            @change="ui.setTerminal({ shell: ($event.target as HTMLSelectElement).value || null })"
          >
            <option value="">{{ t('Automático ({shell})', { shell: defaultShellLabel }) }}</option>
            <option v-for="s in shells?.available ?? []" :key="s.id" :value="s.id">
              {{ s.label }}
            </option>
          </select>
        </SettingRow>
        <SettingRow :label="t('Tamaño de letra')" for="terminal-font">
          <select
            id="terminal-font"
            :value="ui.terminal.fontSize"
            class="h-8 rounded-item border border-border bg-surface px-2 text-sm"
            @change="
              ui.setTerminal({ fontSize: Number(($event.target as HTMLSelectElement).value) })
            "
          >
            <option
              v-for="size in [11, 12, 13, 14, 15, 16, 18, 20, 22, 24]"
              :key="size"
              :value="size"
            >
              {{ size }} px
            </option>
          </select>
        </SettingRow>
        <SettingRow
          :label="t('Modo lector de pantalla')"
          :description="t('Hace la salida de la terminal accesible a lectores de pantalla.')"
          for="terminal-sr"
        >
          <SettingSwitch
            id="terminal-sr"
            :model-value="ui.terminal.screenReader"
            @update:model-value="ui.setTerminal({ screenReader: $event })"
          />
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-notificaciones">
      <h2 id="ajustes-notificaciones" :class="sectionTitle">{{ t('Notificaciones') }}</h2>
      <div :class="section">
        <SettingRow
          :label="t('Notificaciones del sistema')"
          :description="t('Avisos cuando la ventana no tiene el foco.')"
          for="notify-enabled"
        >
          <SettingSwitch
            id="notify-enabled"
            :model-value="notify.enabled"
            @update:model-value="setNotify('enabled', $event)"
          />
        </SettingRow>
        <SettingRow
          v-for="kind in kinds"
          :key="kind.key"
          :label="kind.label"
          :description="kind.description"
          :for="`notify-${kind.key}`"
          :disabled="!notify.enabled"
        >
          <SettingSwitch
            :id="`notify-${kind.key}`"
            :model-value="notify[kind.key]"
            :disabled="!notify.enabled"
            @update:model-value="setNotify(kind.key, $event)"
          />
        </SettingRow>
        <SettingRow
          :label="t('También con la ventana enfocada')"
          for="notify-focused"
          :disabled="!notify.enabled"
        >
          <SettingSwitch
            id="notify-focused"
            :model-value="notify.whenFocused"
            :disabled="!notify.enabled"
            @update:model-value="setNotify('whenFocused', $event)"
          />
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-uso">
      <h2 id="ajustes-uso" :class="sectionTitle">{{ t('Uso') }}</h2>
      <div :class="section">
        <SettingRow
          :label="t('Consultar los límites a Claude Code')"
          :description="
            t('Abre un proceso de Claude Code sin prompt para leer el uso real (no gasta tokens).')
          "
          for="usage-probe"
        >
          <SettingSwitch
            id="usage-probe"
            :model-value="usage.settings.probe"
            @update:model-value="usage.update({ probe: $event })"
          />
        </SettingRow>
        <SettingRow
          :label="t('Mostrar coste equivalente')"
          :description="t('Coste de API según Claude Code, como referencia.')"
          for="usage-cost"
        >
          <SettingSwitch
            id="usage-cost"
            :model-value="usage.settings.showCost"
            @update:model-value="usage.update({ showCost: $event })"
          />
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-ventana">
      <h2 id="ajustes-ventana" :class="sectionTitle">{{ t('Ventana') }}</h2>
      <div :class="section">
        <SettingRow
          :label="t('Mantener en la bandeja al cerrar')"
          :description="
            t(
              'Cerrar la ventana la oculta: los chats y las terminales siguen trabajando y las notificaciones siguen llegando.'
            )
          "
          for="window-tray"
        >
          <SettingSwitch
            id="window-tray"
            :model-value="ui.windowSettings.closeToTray"
            @update:model-value="ui.setWindow({ closeToTray: $event })"
          />
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-acerca">
      <h2 id="ajustes-acerca" :class="sectionTitle">{{ t('Acerca de') }}</h2>
      <div :class="section">
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 py-3 text-sm">
          <template v-for="[name, value] in versions" :key="name">
            <dt class="text-muted">{{ name }}</dt>
            <dd class="font-mono text-[13px]">{{ value }}</dd>
          </template>
        </dl>
      </div>
      <p class="mt-1 flex items-center gap-2 text-xs text-muted">
        {{ t('Proyecto personal, no afiliado a Anthropic.') }}
        <button
          type="button"
          class="rounded-item px-1 text-text underline underline-offset-2 hover:text-accent"
          @click="ui.aboutOpen = true"
        >
          {{ t('Acerca de {app}', { app: 'OpenClod' }) }}
        </button>
      </p>
    </section>
  </div>
</template>
