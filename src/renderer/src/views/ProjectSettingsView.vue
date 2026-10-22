<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MODE_LABELS, type ChatMode } from '../../../shared/chat'
import {
  RULE_PRESETS,
  effective,
  gitRuleState,
  isValidRule,
  withGitRule,
  type GitAction,
  type GitRuleState,
  type ProjectSettings,
  type ProjectSettingsPatch,
  type RuleKind,
  type RulePreset
} from '../../../shared/project-settings'
import SettingRow from '../components/settings/SettingRow.vue'
import SettingSwitch from '../components/settings/SettingSwitch.vue'
import { useProjectsStore } from '../stores/projects'
import { useUiStore } from '../stores/ui'

/**
 * Ajustes del proyecto: permisos y modo por defecto del archivo
 * personal del proyecto (`.claude/settings.local.json`), Git y Claude en Chrome. Cada cambio se
 * guarda al momento; si el archivo cambió en disco (p. ej. por «Permitir siempre»), se recarga y
 * no se pisa.
 */
const route = useRoute()
const ui = useUiStore()
const projects = useProjectsStore()

const projectId = computed(() => String(route.params['id'] ?? ''))
const project = computed(() => projects.projects.find((p) => p.id === projectId.value) ?? null)

const settings = ref<ProjectSettings | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)

async function load(): Promise<void> {
  error.value = null
  const result = await window.api.projectSettings.read(projectId.value)
  if (!result.ok) {
    error.value = result.error.message
    settings.value = null
    return
  }
  settings.value = result.data
}

watch(projectId, () => void load())
onMounted(() => {
  ui.pageTitle = 'Ajustes del proyecto'
  void load()
})
onBeforeUnmount(() => (ui.pageTitle = null))

const local = computed(() => settings.value?.local ?? null)
const readOnly = computed(() => local.value?.invalid === true)

/** Escribe el archivo personal con las reglas y lo que cambie `extra`. */
async function save(
  rules: Pick<ProjectSettingsPatch, 'allow' | 'ask' | 'deny'>,
  extra: Pick<ProjectSettingsPatch, 'defaultMode' | 'coAuthor'> = {}
): Promise<boolean> {
  const current = local.value
  if (!current || saving.value) return false
  saving.value = true
  const result = await window.api.projectSettings.write({
    projectId: projectId.value,
    expectedHash: current.hash,
    allow: [...rules.allow],
    ask: [...rules.ask],
    deny: [...rules.deny],
    ...extra
  })
  saving.value = false
  if (!result.ok) {
    ui.toast(`No se pudo guardar: ${result.error.message}`, { tone: 'danger' })
    return false
  }
  settings.value = result.data.settings
  if (!result.data.ok) {
    ui.toast(
      'Los ajustes cambiaron en disco (quizá desde una sesión). Se han recargado: repite el cambio.',
      {
        tone: 'danger'
      }
    )
    return false
  }
  return true
}

function rulesOf(): Pick<ProjectSettingsPatch, 'allow' | 'ask' | 'deny'> {
  const l = local.value
  return { allow: [...(l?.allow ?? [])], ask: [...(l?.ask ?? [])], deny: [...(l?.deny ?? [])] }
}

// --- Modo por defecto -----------------------------------------------------

const MODES: ChatMode[] = ['default', 'acceptEdits', 'plan']
const modeValue = computed(() => local.value?.defaultMode ?? '')
/** Un modo que la app no ofrece (p. ej. puesto a mano): se muestra y se conserva. */
const otherMode = computed(() => {
  const mode = local.value?.defaultMode
  return mode && !(MODES as string[]).includes(mode) ? mode : null
})
const inheritedMode = computed(() => {
  const s = settings.value
  if (!s) return null
  return effective(
    { local: { ...s.local, defaultMode: null }, shared: s.shared, user: s.user },
    (l) => l.defaultMode
  )
})

function setMode(value: string): void {
  if (value === otherMode.value) return
  void save(rulesOf(), {
    defaultMode: value === '' ? null : (value as 'default' | 'acceptEdits' | 'plan')
  })
}

function modeLabel(mode: string): string {
  return mode in MODE_LABELS ? MODE_LABELS[mode as ChatMode] : mode
}

// --- Accesos rápidos y reglas ----------------------------------------------

function presetOn(preset: RulePreset): boolean {
  const allow = local.value?.allow ?? []
  return preset.rules.every((r) => allow.includes(r))
}

function togglePreset(preset: RulePreset, on: boolean): void {
  const rules = rulesOf()
  const own = new Set(preset.rules)
  rules.allow = rules.allow.filter((r) => !own.has(r))
  if (on) rules.allow.push(...preset.rules)
  void save(rules)
}

const KINDS: { kind: RuleKind; label: string; hint: string }[] = [
  { kind: 'allow', label: 'Permitir', hint: 'Sin preguntar' },
  { kind: 'ask', label: 'Preguntar', hint: 'Siempre pide permiso, aunque otra regla lo permita' },
  { kind: 'deny', label: 'Denegar', hint: 'Claude no puede usarlo' }
]

const newRule = ref('')
const newKind = ref<RuleKind>('allow')
const ruleError = computed(() =>
  newRule.value.trim() !== '' && !isValidRule(newRule.value)
    ? 'Formato: Herramienta o Herramienta(patrón), p. ej. Bash(npm run test *)'
    : null
)

async function addRule(): Promise<void> {
  const rule = newRule.value.trim()
  if (!rule || ruleError.value) return
  const rules = rulesOf()
  for (const kind of ['allow', 'ask', 'deny'] as const)
    rules[kind] = rules[kind].filter((r) => r !== rule)
  rules[newKind.value].push(rule)
  if (await save(rules)) newRule.value = ''
}

function removeRule(kind: RuleKind, rule: string): void {
  const rules = rulesOf()
  rules[kind] = rules[kind].filter((r) => r !== rule)
  void save(rules)
}

/** Reglas de las otras capas (solo lectura). */
const inherited = computed(() => {
  const s = settings.value
  if (!s) return []
  const out: { source: string; kind: RuleKind; rule: string }[] = []
  for (const [source, layer] of [
    ['Compartido del proyecto', s.shared],
    ['Del usuario', s.user]
  ] as const) {
    for (const { kind } of KINDS) for (const rule of layer[kind]) out.push({ source, kind, rule })
  }
  return out
})
const kindLabel = (kind: RuleKind): string => KINDS.find((k) => k.kind === kind)?.label ?? kind

// --- Git -------------------------------------------------------------------

const coAuthor = computed({
  get: () => (settings.value ? (effective(settings.value, (l) => l.coAuthor) ?? true) : true),
  set: (value: boolean) => void save(rulesOf(), { coAuthor: value })
})

const GIT_STATES: { value: GitRuleState; label: string }[] = [
  { value: 'inherit', label: 'Según las demás reglas' },
  { value: 'ask', label: 'Preguntar siempre' },
  { value: 'allow', label: 'Permitir sin preguntar' },
  { value: 'deny', label: 'No permitir' }
]

function gitState(action: GitAction): GitRuleState {
  return local.value ? gitRuleState(local.value, action) : 'inherit'
}

function setGit(action: GitAction, state: GitRuleState): void {
  if (!local.value) return
  void save(withGitRule(local.value, action, state))
}

// --- Claude en Chrome -----------------------------------------------------------

const chrome = computed({
  get: () => settings.value?.chrome ?? false,
  set: async (value: boolean) => {
    const result = await window.api.projectSettings.setChrome(projectId.value, value)
    if (!result.ok)
      return ui.toast(`No se pudo guardar: ${result.error.message}`, { tone: 'danger' })
    if (settings.value) settings.value = { ...settings.value, chrome: value }
  }
})

const sectionTitle = 'mb-1 font-serif text-lg'
const section = 'divide-y divide-border rounded-item border border-border bg-surface px-4'
const select = 'h-8 rounded-item border border-border bg-surface px-2 text-sm disabled:opacity-50'
</script>

<template>
  <div class="mx-auto flex w-full max-w-[40rem] flex-col gap-8 px-6 py-8">
    <header class="flex flex-col gap-0.5">
      <h2 class="font-serif text-2xl">{{ project?.name ?? 'Proyecto' }}</h2>
      <p class="truncate font-mono text-xs text-muted" :title="local?.path">
        {{ local?.path ?? project?.path ?? '' }}
      </p>
    </header>

    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
    <p
      v-else-if="readOnly"
      class="rounded-item border border-warning px-3 py-2 text-sm"
      role="alert"
    >
      <code class="font-mono">settings.local.json</code> no es JSON válido. Corrígelo a mano para
      poder cambiar aquí los ajustes.
    </p>

    <template v-if="settings && local">
      <section aria-labelledby="proyecto-permisos">
        <h2 id="proyecto-permisos" :class="sectionTitle">Permisos</h2>
        <p class="mb-2 text-xs text-muted">
          Se guardan en el archivo personal del proyecto y valen para todas sus sesiones, en la app
          y en la terminal. Se aplican a las sesiones que empiecen o se reanuden a partir de ahora.
        </p>
        <div :class="section">
          <SettingRow
            label="Modo al empezar"
            for="proyecto-modo"
            :description="
              inheritedMode && !local.defaultMode
                ? `Heredado: ${modeLabel(inheritedMode)}`
                : 'Modo de permisos de las sesiones nuevas.'
            "
          >
            <select
              id="proyecto-modo"
              :value="modeValue"
              :disabled="readOnly || saving"
              :class="select"
              @change="setMode(($event.target as HTMLSelectElement).value)"
            >
              <option value="">La última que elegí</option>
              <option v-for="mode in MODES" :key="mode" :value="mode">
                {{ MODE_LABELS[mode] }}
              </option>
              <option v-if="otherMode" :value="otherMode">{{ otherMode }}</option>
            </select>
          </SettingRow>
          <SettingRow
            v-for="preset in RULE_PRESETS"
            :key="preset.id"
            :label="preset.label"
            :description="`${preset.hint} sin preguntar · ${preset.rules.join(', ')}`"
            :for="`preset-${preset.id}`"
          >
            <SettingSwitch
              :id="`preset-${preset.id}`"
              :model-value="presetOn(preset)"
              :disabled="readOnly || saving"
              @update:model-value="togglePreset(preset, $event)"
            />
          </SettingRow>
        </div>
      </section>

      <section aria-labelledby="proyecto-reglas">
        <h2 id="proyecto-reglas" :class="sectionTitle">Reglas</h2>
        <p class="mb-2 text-xs text-muted">
          Denegar manda sobre preguntar, y preguntar sobre permitir. «Permitir siempre» en una
          petición de permiso con «en este proyecto» también las añade aquí.
        </p>
        <div class="flex flex-col gap-3 rounded-item border border-border bg-surface p-4">
          <div v-for="k in KINDS" :key="k.kind" class="flex flex-col gap-1">
            <p class="text-sm">
              {{ k.label }} <span class="text-xs text-muted">· {{ k.hint }}</span>
            </p>
            <ul v-if="local[k.kind].length > 0" class="flex flex-wrap gap-1.5">
              <li
                v-for="rule in local[k.kind]"
                :key="rule"
                class="inline-flex max-w-full items-center gap-1 rounded-item border border-border py-0.5 pr-0.5 pl-2"
              >
                <code class="min-w-0 truncate font-mono text-[12px]" :title="rule">{{ rule }}</code>
                <button
                  type="button"
                  class="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
                  :aria-label="`Quitar ${rule}`"
                  :disabled="readOnly || saving"
                  @click="removeRule(k.kind, rule)"
                >
                  <X :size="12" :stroke-width="2" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <p v-else class="text-xs text-muted">Ninguna.</p>
          </div>

          <form class="flex flex-col gap-1 border-t border-border pt-3" @submit.prevent="addRule">
            <div class="flex gap-2">
              <select
                v-model="newKind"
                aria-label="Tipo de regla"
                :class="select"
                :disabled="readOnly"
              >
                <option v-for="k in KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
              </select>
              <input
                v-model="newRule"
                maxlength="600"
                spellcheck="false"
                aria-label="Regla"
                placeholder="Bash(npm run test *)"
                :disabled="readOnly"
                class="h-8 min-w-0 flex-1 rounded-item border border-border bg-bg px-2 font-mono text-[13px] outline-none placeholder:text-muted focus-visible:border-accent"
              />
              <button
                type="submit"
                class="inline-flex h-8 items-center gap-1 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
                :disabled="readOnly || saving || !newRule.trim() || !!ruleError"
              >
                <Plus :size="14" :stroke-width="2" aria-hidden="true" /> Añadir
              </button>
            </div>
            <p v-if="ruleError" class="text-xs text-danger">{{ ruleError }}</p>
          </form>

          <details v-if="inherited.length > 0" class="border-t border-border pt-3 text-sm">
            <summary class="cursor-default text-muted">
              Reglas de otros archivos ({{ inherited.length }}, solo lectura)
            </summary>
            <ul class="mt-2 flex flex-col gap-1">
              <li
                v-for="r in inherited"
                :key="`${r.source}-${r.kind}-${r.rule}`"
                class="flex min-w-0 items-baseline gap-2 text-xs"
              >
                <span class="shrink-0 text-muted">{{ r.source }} · {{ kindLabel(r.kind) }}</span>
                <code class="min-w-0 truncate font-mono" :title="r.rule">{{ r.rule }}</code>
              </li>
            </ul>
          </details>
        </div>
      </section>

      <section aria-labelledby="proyecto-git">
        <h2 id="proyecto-git" :class="sectionTitle">Git</h2>
        <div :class="section">
          <SettingRow
            label="Coautoría de Claude"
            for="proyecto-coautor"
            description="Añadir «Co-Authored-By: Claude» a los commits y la firma de Claude Code a los PR."
          >
            <SettingSwitch
              id="proyecto-coautor"
              v-model="coAuthor"
              :disabled="readOnly || saving"
            />
          </SettingRow>
          <SettingRow
            v-for="action in ['commit', 'push'] as const"
            :key="action"
            :label="action === 'commit' ? 'Hacer commit' : 'Hacer push'"
            :for="`proyecto-git-${action}`"
            :description="
              action === 'commit'
                ? 'Si Claude puede ejecutar git commit por su cuenta.'
                : 'Si Claude puede ejecutar git push por su cuenta.'
            "
          >
            <select
              :id="`proyecto-git-${action}`"
              :value="gitState(action)"
              :disabled="readOnly || saving"
              :class="select"
              @change="setGit(action, ($event.target as HTMLSelectElement).value as GitRuleState)"
            >
              <option v-for="s in GIT_STATES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </SettingRow>
        </div>
      </section>

      <section aria-labelledby="proyecto-chrome">
        <h2 id="proyecto-chrome" :class="sectionTitle">Claude en Chrome</h2>
        <div :class="section">
          <SettingRow
            label="Usar Claude en Chrome"
            for="proyecto-chrome-switch"
            description="Las sesiones del proyecto pueden manejar tu Chrome (necesita la extensión Claude in Chrome). En una sesión, también con /chrome."
          >
            <SettingSwitch id="proyecto-chrome-switch" v-model="chrome" />
          </SettingRow>
        </div>
      </section>
    </template>
  </div>
</template>
