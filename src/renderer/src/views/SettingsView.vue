<script setup lang="ts">
import { FolderOpen, RotateCcw } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { TerminalShells } from '../../../shared/terminal'
import type { NotificationSettings, SystemInfo } from '../../../shared/types'
import SettingRow from '../components/settings/SettingRow.vue'
import SettingSwitch from '../components/settings/SettingSwitch.vue'
import ThemeToggle from '../components/ui/ThemeToggle.vue'
import { useUiStore } from '../stores/ui'
import { useUsageStore } from '../stores/usage'

/**
 * Ajustes: cada cambio se guarda al momento en
 * `state.json` a través del main.
 */
const ui = useUiStore()
const usage = useUsageStore()

const info = ref<SystemInfo | null>(null)
const claude = ref<{ dir: string; source: 'settings' | 'env' | 'default' } | null>(null)
const claudeError = ref<string | null>(null)

const SOURCES = {
  settings: 'Elegida en Ajustes',
  env: 'Variable CLAUDE_CONFIG_DIR',
  default: 'Predeterminada'
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
    label: 'Al terminar',
    description: 'Claude ha terminado un turno o ha fallado.'
  },
  { key: 'permission', label: 'Permisos y preguntas', description: 'Claude espera tu respuesta.' },
  { key: 'tasks', label: 'Tareas en segundo plano', description: 'Una tarea termina o falla.' },
  { key: 'limit', label: 'Límite de uso', description: 'Se alcanza el límite de 5 horas.' }
] as const

const versions = computed(() => {
  const i = info.value
  if (!i) return []
  return [
    ['OpenClod', i.app],
    ['Claude Code (incluido)', i.claudeCode ?? '—'],
    ['Electron', i.electron],
    ['Chromium', i.chrome],
    ['Node.js', i.node],
    ['Git', i.git ?? 'No encontrado']
  ]
})

const sectionTitle = 'mb-1 font-serif text-lg'
const section = 'divide-y divide-border rounded-item border border-border bg-surface px-4'
</script>

<template>
  <div class="mx-auto flex w-full max-w-[40rem] flex-col gap-8 px-6 py-8">
    <section aria-labelledby="ajustes-apariencia">
      <h2 id="ajustes-apariencia" :class="sectionTitle">Apariencia</h2>
      <div :class="section">
        <SettingRow label="Tema" description="Claro, oscuro o el del sistema.">
          <ThemeToggle />
        </SettingRow>
      </div>
    </section>

    <section aria-labelledby="ajustes-claude">
      <h2 id="ajustes-claude" :class="sectionTitle">Claude Code</h2>
      <div :class="section">
        <SettingRow label="Carpeta de datos" :description="claude ? SOURCES[claude.source] : ''">
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
            title="Volver a la predeterminada"
            @click="setClaudeDir(null)"
          >
            <RotateCcw :size="16" :stroke-width="1.75" aria-hidden="true" />
            Predeterminada
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item border border-border px-3 text-sm hover:bg-surface-hover"
            @click="pickClaudeDir"
          >
            <FolderOpen :size="16" :stroke-width="1.75" aria-hidden="true" />
            Elegir otra…
          </button>
        </SettingRow>
      </div>
      <p class="mt-1 text-xs text-muted">
        OpenClod solo lee esta carpeta; las sesiones las escribe Claude Code.
      </p>
    </section>

    <section aria-labelledby="ajustes-terminal">
      <h2 id="ajustes-terminal" :class="sectionTitle">Terminal</h2>
      <div :class="section">
        <SettingRow
          label="Shell"
          :description="
            shells?.error ? `No disponible: ${shells.error}` : 'Se usa al abrir terminales nuevas.'
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
            <option value="">Automático ({{ defaultShellLabel }})</option>
            <option v-for="s in shells?.available ?? []" :key="s.id" :value="s.id">
              {{ s.label }}
            </option>
          </select>
        </SettingRow>
        <SettingRow label="Tamaño de letra" for="terminal-font">
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
          label="Modo lector de pantalla"
          description="Hace la salida de la terminal accesible a lectores de pantalla."
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
      <h2 id="ajustes-notificaciones" :class="sectionTitle">Notificaciones</h2>
      <div :class="section">
        <SettingRow
          label="Notificaciones del sistema"
          description="Avisos cuando la ventana no tiene el foco."
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
          label="También con la ventana enfocada"
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
      <h2 id="ajustes-uso" :class="sectionTitle">Uso</h2>
      <div :class="section">
        <SettingRow
          label="Consultar los límites a Claude Code"
          description="Abre un proceso de Claude Code sin prompt para leer el uso real (no gasta tokens)."
          for="usage-probe"
        >
          <SettingSwitch
            id="usage-probe"
            :model-value="usage.settings.probe"
            @update:model-value="usage.update({ probe: $event })"
          />
        </SettingRow>
        <SettingRow
          label="Mostrar coste equivalente"
          description="Coste de API según Claude Code, como referencia."
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
      <h2 id="ajustes-ventana" :class="sectionTitle">Ventana</h2>
      <div :class="section">
        <SettingRow
          label="Mantener en la bandeja al cerrar"
          description="Cerrar la ventana la oculta: los chats y las terminales siguen trabajando y las notificaciones siguen llegando."
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
      <h2 id="ajustes-acerca" :class="sectionTitle">Acerca de</h2>
      <div :class="section">
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 py-3 text-sm">
          <template v-for="[name, value] in versions" :key="name">
            <dt class="text-muted">{{ name }}</dt>
            <dd class="font-mono text-[13px]">{{ value }}</dd>
          </template>
        </dl>
      </div>
      <p class="mt-1 flex items-center gap-2 text-xs text-muted">
        Proyecto personal, no afiliado a Anthropic.
        <button
          type="button"
          class="rounded-item px-1 text-text underline underline-offset-2 hover:text-accent"
          @click="ui.aboutOpen = true"
        >
          Acerca de OpenClod
        </button>
      </p>
    </section>
  </div>
</template>
