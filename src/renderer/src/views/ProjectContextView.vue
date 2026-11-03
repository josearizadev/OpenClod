<script setup lang="ts">
import { t } from '../i18n'
import {
  FilePlus,
  FileText,
  FolderOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import {
  CONTEXT_FILE_MAX,
  CONTEXT_SEND_MAX,
  estimateTokens,
  isContextName,
  type ContextFile,
  type ContextFolderListing
} from '../../../shared/context'
import SettingSwitch from '../components/settings/SettingSwitch.vue'
import MarkdownContent from '../components/transcript/MarkdownContent.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { formatTokens } from '../lib/tokens'
import { useProjectsStore } from '../stores/projects'
import { useUiStore } from '../stores/ui'

/**
 * Contexto del proyecto: archivos `.md` en los datos de OpenClod (no en el repositorio) que se
 * añaden al prompt de Claude Code al empezar cada sesión nueva. Se pueden activar, crear, editar
 * con vista previa, renombrar y eliminar; guardar nunca pisa un cambio hecho fuera.
 */
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const projects = useProjectsStore()

const projectId = computed(() => String(route.params['id'] ?? ''))
const project = computed(() => projects.projects.find((p) => p.id === projectId.value) ?? null)

const listing = ref<ContextFolderListing | null>(null)
const error = ref<string | null>(null)
const selected = ref<string | null>(null)
const file = ref<ContextFile | null>(null)
const draft = ref('')
const tab = ref<'write' | 'preview'>('write')
const saving = ref(false)
const conflict = ref<ContextFile | null>(null)

const dirty = computed(() => file.value !== null && draft.value !== file.value.text)
const activeChars = computed(() =>
  (listing.value?.files ?? []).filter((f) => f.enabled).reduce((sum, f) => sum + f.size, 0)
)
const activeCount = computed(() => listing.value?.files.filter((f) => f.enabled).length ?? 0)

async function load(): Promise<void> {
  const result = await window.api.context.list(projectId.value)
  if (!result.ok) {
    error.value = result.error.message
    listing.value = null
    return
  }
  error.value = null
  listing.value = result.data
  const names = result.data.files.map((f) => f.name)
  if (selected.value && !names.includes(selected.value)) {
    selected.value = null
    file.value = null
  }
  if (!selected.value && names[0]) await open(names[0])
}

async function open(name: string): Promise<void> {
  const result = await window.api.context.read(projectId.value, name)
  if (!result.ok) {
    ui.toast(result.error.message, { tone: 'danger' })
    await load()
    return
  }
  selected.value = name
  file.value = result.data
  draft.value = result.data.text
  conflict.value = null
  tab.value = 'write'
}

watch(projectId, () => {
  selected.value = null
  file.value = null
  void load()
})
onMounted(() => {
  ui.pageTitle = t('Contexto del proyecto')
  void load()
})
onBeforeUnmount(() => (ui.pageTitle = null))
// Al volver a la ventana (p. ej. tras añadir archivos en el explorador), la lista se actualiza.
function onFocus(): void {
  if (!dirty.value) void load()
}
window.addEventListener('focus', onFocus)
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

async function save(): Promise<void> {
  const current = file.value
  if (!current || saving.value) return
  saving.value = true
  const result = await window.api.context.write({
    projectId: projectId.value,
    name: current.name,
    text: draft.value,
    expectedHash: current.hash
  })
  saving.value = false
  if (!result.ok) {
    ui.toast(t('No se pudo guardar: {error}', { error: result.error.message }), { tone: 'danger' })
    return
  }
  if (!result.data.ok) {
    conflict.value = result.data.file ?? { name: current.name, text: '', hash: '' }
    return
  }
  file.value = result.data.file
  draft.value = result.data.file.text
  await load()
  ui.toast(t('Guardado'))
}

function reloadFromDisk(): void {
  if (!conflict.value || !selected.value) return
  conflict.value = null
  void open(selected.value)
}

async function copyDraft(): Promise<void> {
  try {
    await navigator.clipboard.writeText(draft.value)
    ui.toast(t('Tu versión está en el portapapeles'))
  } catch {
    ui.toast(t('No se pudo copiar'), { tone: 'danger' })
  }
}

async function setEnabled(name: string, enabled: boolean): Promise<void> {
  const result = await window.api.context.setEnabled(projectId.value, name, enabled)
  if (!result.ok) ui.toast(result.error.message, { tone: 'danger' })
  await load()
}

async function openFolder(): Promise<void> {
  const result = await window.api.context.openFolder(projectId.value)
  if (!result.ok) ui.toast(result.error.message, { tone: 'danger' })
}

// --- Nombre (nuevo archivo o renombrar) -------------------------------
/** `'new'`: crear; un nombre: renombrar ese archivo. */
const naming = ref<'new' | string | null>(null)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

/** Añade `.md` si falta. */
function withExtension(name: string): string {
  const clean = name.trim()
  return /\.md$/i.test(clean) ? clean : `${clean}.md`
}
const nameValid = computed(() => isContextName(withExtension(nameDraft.value)))

async function startNaming(target: 'new' | string): Promise<void> {
  naming.value = target
  nameDraft.value = target === 'new' ? '' : target.replace(/\.md$/i, '')
  await nextTick()
  nameInput.value?.select()
}

async function commitName(): Promise<void> {
  const target = naming.value
  if (!target || !nameValid.value) return
  const name = withExtension(nameDraft.value)
  if (target === 'new') {
    const result = await window.api.context.write({
      projectId: projectId.value,
      name,
      text: '',
      expectedHash: null
    })
    if (!result.ok || !result.data.ok) {
      ui.toast(result.ok ? t('Ya hay un archivo con ese nombre.') : result.error.message, {
        tone: 'danger'
      })
      return
    }
    naming.value = null
    await load()
    await open(name)
    return
  }
  const result = await window.api.context.rename(projectId.value, target, name)
  if (!result.ok) {
    ui.toast(result.error.message, { tone: 'danger' })
    return
  }
  naming.value = null
  if (selected.value === target) selected.value = name
  if (file.value?.name === target) file.value = { ...file.value, name }
  await load()
}

// --- Eliminar -----------------------------------------------------------
const removeOpen = ref(false)
async function remove(): Promise<void> {
  const name = selected.value
  if (!name) return
  const result = await window.api.context.remove(projectId.value, name)
  if (!result.ok) ui.toast(result.error.message, { tone: 'danger' })
  selected.value = null
  file.value = null
  await load()
}

// --- Cambios sin guardar -------------------------------------------------
const leaveOpen = ref(false)
let pendingRoute: RouteLocationRaw | null = null
let pendingFile: string | null = null

function select(name: string): void {
  if (name === selected.value) return
  if (dirty.value) {
    pendingFile = name
    leaveOpen.value = true
    return
  }
  void open(name)
}

onBeforeRouteLeave((to) => {
  if (!dirty.value || pendingRoute) return true
  pendingRoute = to.fullPath
  leaveOpen.value = true
  return false
})

function discard(): void {
  if (file.value) draft.value = file.value.text
  if (pendingFile) {
    const name = pendingFile
    pendingFile = null
    void open(name)
  } else if (pendingRoute) {
    const to = pendingRoute
    void router.push(to).finally(() => (pendingRoute = null))
  }
}
watch(leaveOpen, (open) => {
  if (!open)
    setTimeout(() => {
      pendingRoute = null
      pendingFile = null
    }, 0)
})

const sizeOf = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

const tabClass =
  'h-7 rounded-item px-2.5 text-sm transition-colors duration-150 hover:bg-surface-hover aria-selected:bg-surface-hover aria-selected:font-medium'
const button =
  'inline-flex h-8 items-center gap-1.5 rounded-item px-3 text-sm transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50'
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
    <header class="mb-2 flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-serif text-2xl">{{ t('Contexto del proyecto') }}</h2>
        <p class="truncate text-sm text-muted">{{ project?.name }}</p>
      </div>
      <button type="button" :class="button" @click="load">
        <RefreshCw :size="16" :stroke-width="1.75" aria-hidden="true" /> {{ t('Actualizar') }}
      </button>
      <button type="button" :class="button" @click="openFolder">
        <FolderOpen :size="16" :stroke-width="1.75" aria-hidden="true" />
        {{ t('Abrir carpeta') }}
      </button>
      <button
        type="button"
        :class="[button, 'bg-accent text-on-accent hover:bg-accent-hover']"
        @click="startNaming('new')"
      >
        <FilePlus :size="16" :stroke-width="1.75" aria-hidden="true" /> {{ t('Nuevo archivo') }}
      </button>
    </header>
    <p class="mb-1 max-w-3xl text-sm text-muted">
      {{
        t(
          'Archivos Markdown que OpenClod añade a las instrucciones de Claude Code al empezar cada sesión nueva de este proyecto, como un CLAUDE.md que no está en el repositorio. Las sesiones ya empezadas conservan el contexto con el que empezaron.'
        )
      }}
    </p>
    <p class="mb-4 text-sm" :class="activeChars > CONTEXT_SEND_MAX ? 'text-danger' : 'text-muted'">
      {{
        t('{n} de {total} activos · ≈ {tokens} tokens en cada sesión nueva', {
          n: activeCount,
          total: listing?.files.length ?? 0,
          tokens: formatTokens(estimateTokens(activeChars))
        })
      }}
      <template v-if="activeChars > CONTEXT_SEND_MAX">
        · {{ t('Se recortará: el máximo son {n} caracteres.', { n: CONTEXT_SEND_MAX }) }}
      </template>
    </p>

    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>

    <div v-else class="flex min-h-0 flex-1 gap-4">
      <!-- Lista de archivos. -->
      <section class="flex w-64 shrink-0 flex-col gap-1" :aria-label="t('Archivos')">
        <form
          v-if="naming === 'new'"
          class="flex flex-col gap-1 rounded-item border border-border p-2"
          @submit.prevent="commitName"
        >
          <input
            ref="nameInput"
            v-model="nameDraft"
            type="text"
            maxlength="96"
            :aria-label="t('Nombre del archivo')"
            :placeholder="t('convenciones')"
            class="h-8 rounded-item border border-border bg-bg px-2 text-sm outline-none focus:border-accent"
            @keydown.esc.prevent="naming = null"
          />
          <span class="text-xs text-muted">{{ withExtension(nameDraft || '…') }}</span>
          <div class="flex justify-end gap-1">
            <button type="button" :class="button" @click="naming = null">
              {{ t('Cancelar') }}
            </button>
            <button
              type="submit"
              :disabled="!nameValid"
              :class="[button, 'bg-accent text-on-accent hover:bg-accent-hover']"
            >
              {{ t('Crear') }}
            </button>
          </div>
        </form>
        <p
          v-if="listing && listing.files.length === 0 && naming !== 'new'"
          class="text-sm text-muted"
        >
          {{ t('Aún no hay archivos. Crea uno o añádelos con «Abrir carpeta».') }}
        </p>
        <ul class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          <li
            v-for="info in listing?.files ?? []"
            :key="info.name"
            class="flex items-center gap-2 rounded-item pr-2 transition-colors duration-150 hover:bg-surface-hover"
            :class="selected === info.name ? 'bg-surface-hover' : ''"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
              :aria-current="selected === info.name ? 'true' : undefined"
              @click="select(info.name)"
            >
              <FileText
                :size="16"
                :stroke-width="1.75"
                class="shrink-0"
                :class="info.enabled ? '' : 'text-muted'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate" :class="info.enabled ? '' : 'text-muted line-through'">
                  {{ info.name }}
                </span>
                <span class="block text-xs text-muted">{{ sizeOf(info.size) }}</span>
              </span>
            </button>
            <SettingSwitch
              :model-value="info.enabled"
              :label="t('Enviar {name}', { name: info.name })"
              @update:model-value="(on: boolean) => setEnabled(info.name, on)"
            />
          </li>
        </ul>
        <p
          v-if="listing"
          class="mt-auto truncate pt-2 font-mono text-[11px] text-muted"
          :title="listing.dir"
        >
          {{ listing.dir }}
        </p>
      </section>

      <!-- Editor. -->
      <section v-if="file" class="flex min-w-0 flex-1 flex-col gap-2" :aria-label="file.name">
        <div class="flex flex-wrap items-center gap-2">
          <form
            v-if="naming === file.name"
            class="flex items-center gap-1"
            @submit.prevent="commitName"
          >
            <input
              ref="nameInput"
              v-model="nameDraft"
              type="text"
              maxlength="96"
              :aria-label="t('Nombre del archivo')"
              class="h-8 w-56 rounded-item border border-border bg-bg px-2 text-sm outline-none focus:border-accent"
              @keydown.esc.prevent="naming = null"
            />
            <span class="text-sm text-muted">.md</span>
            <button type="submit" :disabled="!nameValid" :class="button">{{ t('Guardar') }}</button>
          </form>
          <h3 v-else class="min-w-0 truncate font-medium">{{ file.name }}</h3>
          <button
            v-if="naming !== file.name"
            type="button"
            :class="button"
            :aria-label="t('Renombrar')"
            :title="t('Renombrar')"
            @click="startNaming(file.name)"
          >
            <Pencil :size="16" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <button
            type="button"
            :class="[button, 'text-danger']"
            :aria-label="t('Eliminar…')"
            :title="t('Eliminar…')"
            @click="removeOpen = true"
          >
            <Trash2 :size="16" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <div role="tablist" :aria-label="file.name" class="ml-auto flex gap-1">
            <button
              type="button"
              role="tab"
              :aria-selected="tab === 'write'"
              :class="tabClass"
              @click="tab = 'write'"
            >
              {{ t('Escribir') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="tab === 'preview'"
              :class="tabClass"
              @click="tab = 'preview'"
            >
              {{ t('Vista previa') }}
            </button>
          </div>
          <button
            type="button"
            :class="[button, 'bg-accent text-on-accent hover:bg-accent-hover']"
            :disabled="!dirty || saving || draft.length > CONTEXT_FILE_MAX"
            @click="save"
          >
            <Save :size="16" :stroke-width="1.75" aria-hidden="true" /> {{ t('Guardar') }}
          </button>
        </div>

        <div
          v-if="conflict"
          class="flex flex-wrap items-center gap-2 rounded-item border border-warning px-3 py-2 text-sm"
          role="alert"
        >
          <span class="min-w-0 flex-1">
            {{ t('El archivo ha cambiado en disco desde que lo abriste. No se ha guardado nada.') }}
          </span>
          <button type="button" :class="button" @click="copyDraft">
            {{ t('Copiar mi versión') }}
          </button>
          <button
            type="button"
            :class="[button, 'font-medium text-accent']"
            @click="reloadFromDisk"
          >
            <RotateCcw :size="14" :stroke-width="1.75" aria-hidden="true" /> {{ t('Recargar') }}
          </button>
        </div>

        <textarea
          v-if="tab === 'write'"
          v-model="draft"
          class="min-h-0 w-full flex-1 resize-none rounded-item border border-border bg-surface p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
          :aria-label="t('Contenido de {name}', { name: file.name })"
          spellcheck="false"
          @keydown.ctrl.s.prevent="save"
        />
        <div v-else class="min-h-0 flex-1 overflow-y-auto rounded-item border border-border p-3">
          <MarkdownContent v-if="draft.trim()" :source="draft" />
          <p v-else class="text-sm text-muted">{{ t('Archivo vacío.') }}</p>
        </div>
      </section>
      <p v-else-if="listing && listing.files.length > 0" class="flex-1 text-sm text-muted">
        {{ t('Elige un archivo para editarlo.') }}
      </p>
    </div>

    <ConfirmDialog
      v-model:open="removeOpen"
      :title="t('¿Eliminar «{name}»?', { name: selected ?? '' })"
      :description="t('El archivo irá a la papelera del sistema.')"
      :confirm-label="t('Eliminar')"
      danger
      @confirm="remove"
    />
    <ConfirmDialog
      v-model:open="leaveOpen"
      :title="t('¿Descartar los cambios?')"
      :description="t('Tienes cambios sin guardar en {name}.', { name: file?.name ?? '' })"
      :confirm-label="t('Descartar')"
      danger
      @confirm="discard"
    />
  </div>
</template>
