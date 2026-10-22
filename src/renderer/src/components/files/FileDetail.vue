<script setup lang="ts">
import { ExternalLink, FolderOpen } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import {
  unsafeToOpen,
  type FileDiff,
  type FilePreview,
  type FileTarget
} from '../../../../shared/files'
import type { GitFileChange } from '../../../../shared/git'
import { isWindowsPath } from '../../lib/files'
import type { TouchedFile } from '../../lib/transcript/files'
import { useGitStore } from '../../stores/git'
import { useUiStore } from '../../stores/ui'
import IconButton from '../ui/IconButton.vue'
import FileChanges from './FileChanges.vue'
import FilePreviewView from './FilePreview.vue'
import GitDiff from './GitDiff.vue'

/**
 * Detalle de un archivo del panel: pestañas Cambios (de la sesión),
 * Contenido (disco) y Diff Git, y acciones abrir en el editor / mostrar en la carpeta.
 */
const props = defineProps<{
  target: FileTarget
  /** Lo que se pide al main: absoluta o relativa a la carpeta de la sesión. */
  path: string
  /** Desde qué lista se abrió: elige la pestaña inicial. */
  source: 'session' | 'git'
  sessionFile?: TouchedFile
  gitChange?: GitFileChange
  cwd?: string
}>()

type Tab = 'changes' | 'content' | 'git'

const git = useGitStore()
const ui = useUiStore()

const tabs = computed(() => {
  const list: { id: Tab; label: string }[] = []
  const f = props.sessionFile
  if (f && (f.changes.length > 0 || f.commands.length > 0)) {
    list.push({ id: 'changes', label: 'Cambios' })
  }
  list.push({ id: 'content', label: 'Contenido' })
  if (props.gitChange) list.push({ id: 'git', label: 'Diff Git' })
  return list
})

function initialTab(): Tab {
  if (props.source === 'git' && props.gitChange) return 'git'
  return tabs.value[0]?.id ?? 'content'
}

const tab = ref<Tab>(initialTab())
watch(
  () => props.path,
  () => (tab.value = initialTab())
)
watch(tabs, (list) => {
  if (!list.some((t) => t.id === tab.value)) tab.value = initialTab()
})

const preview = ref<FilePreview | null>(null)
const diff = ref<FileDiff | null>(null)
const error = ref<string | null>(null)
let seq = 0

async function load(): Promise<void> {
  const mine = ++seq
  const args = { target: { ...props.target }, path: props.path }
  if (tab.value === 'content') {
    const result = await window.api.files.read(args)
    if (mine !== seq) return
    error.value = result.ok ? null : result.error.message
    preview.value = result.ok ? result.data : null
  } else if (tab.value === 'git') {
    const result = await window.api.files.diff(args)
    if (mine !== seq) return
    error.value = result.ok ? null : result.error.message
    diff.value = result.ok ? result.data : null
  }
}

watch(
  () => [props.path, tab.value, JSON.stringify(props.target)],
  () => {
    preview.value = null
    diff.value = null
    error.value = null
    void load()
  },
  { immediate: true }
)
// Claude edita el archivo: se recarga con cada consulta de Git (≤ 1 cada 2 s).
watch(
  () => git.tick,
  () => void load()
)

const canEdit = computed(() => !unsafeToOpen(props.path, isWindowsPath(props.cwd ?? props.path)))

async function open(how: 'editor' | 'folder'): Promise<void> {
  const result = await window.api.files.open({
    target: { ...props.target },
    path: props.path,
    how
  })
  if (!result.ok) ui.toast(result.error.message, { tone: 'danger' })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
      <div class="flex gap-0.5 rounded-item bg-surface-hover p-0.5" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          :aria-selected="tab === t.id"
          class="rounded-[6px] px-2 py-0.5 text-xs transition-colors duration-150"
          :class="tab === t.id ? 'bg-surface text-text shadow-float' : 'text-muted hover:text-text'"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <span class="flex-1" />
      <IconButton
        v-if="canEdit"
        :icon="ExternalLink"
        label="Abrir en el editor"
        @click="open('editor')"
      />
      <IconButton :icon="FolderOpen" label="Mostrar en la carpeta" @click="open('folder')" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <FileChanges v-else-if="tab === 'changes' && sessionFile" :file="sessionFile" :cwd="cwd" />
      <template v-else-if="tab === 'content'">
        <FilePreviewView v-if="preview" :preview="preview" />
        <div v-else class="h-24 animate-pulse rounded-item bg-surface-hover" aria-busy="true" />
      </template>
      <template v-else-if="tab === 'git'">
        <GitDiff v-if="diff" :diff="diff" />
        <div v-else class="h-24 animate-pulse rounded-item bg-surface-hover" aria-busy="true" />
      </template>
    </div>
  </div>
</template>
