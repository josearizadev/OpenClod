<script setup lang="ts">
import { ArrowLeft, FileMinus, FilePen, FilePlus, FileQuestion, X } from 'lucide-vue-next'
import { computed, type Component } from 'vue'
import type { GitFileChange } from '../../../../shared/git'
import { isWindowsPath, joinPath } from '../../lib/files'
import { fileKey, gitAbsolute, gitChangeLabel, gitChangeLetter, gitChangeTone } from '../../lib/git'
import type { TouchedFile } from '../../lib/transcript/files'
import { useFilesStore, type FilesList } from '../../stores/files'
import { useGitStore } from '../../stores/git'
import IconButton from '../ui/IconButton.vue'
import FileDetail from './FileDetail.vue'

/**
 * Panel derecho de archivos: listas
 * Sesión (lo que tocó la sesión) y Git (cambios del repositorio) y el detalle del elegido.
 */
const props = defineProps<{
  files: TouchedFile[]
  sessionId: string
  cwd?: string
}>()

const emit = defineEmits<{ close: [] }>()

const store = useFilesStore()
const git = useGitStore()

const windows = computed(() => isWindowsPath(props.cwd))
const status = computed(() => git.info?.status ?? null)
const changes = computed(() => status.value?.files ?? [])

/** Cambio de Git de cada archivo, por ruta absoluta normalizada. */
const gitByKey = computed(() => {
  const map = new Map<string, GitFileChange>()
  const s = status.value
  if (!s) return map
  for (const change of s.files) {
    map.set(fileKey(gitAbsolute(s.root, change.path), windows.value), change)
  }
  return map
})

function sessionAbs(file: TouchedFile): string {
  return joinPath(props.cwd, file.path)
}

const current = computed(() => {
  const sel = store.selected
  if (!sel) return null
  const key = fileKey(joinPath(props.cwd, sel.path), windows.value)
  const sessionFile =
    sel.source === 'session'
      ? props.files.find((f) => f.key === sel.key)
      : props.files.find((f) => fileKey(sessionAbs(f), windows.value) === key)
  return {
    ...sel,
    sessionFile,
    gitChange: gitByKey.value.get(key)
  }
})

const title = computed(() => {
  const c = current.value
  if (!c) return ''
  if (c.sessionFile) return c.sessionFile.path
  return c.key.startsWith('git:') ? c.key.slice(4) : c.path
})

function selectSession(file: TouchedFile): void {
  store.open({ source: 'session', key: file.key, path: file.path })
}

function selectGit(change: GitFileChange): void {
  if (status.value) store.openGit(status.value.root, change.path)
}

const lists: { id: FilesList; label: string }[] = [
  { id: 'session', label: 'Sesión' },
  { id: 'git', label: 'Git' }
]

const STATUS: Record<TouchedFile['status'], { icon: Component; label: string; tone: string }> = {
  created: { icon: FilePlus, label: 'Creado', tone: 'text-diff-add' },
  edited: { icon: FilePen, label: 'Editado', tone: 'text-muted' },
  deleted: { icon: FileMinus, label: 'Borrado', tone: 'text-diff-del' },
  command: { icon: FileQuestion, label: 'Detectado por comando', tone: 'text-muted' }
}
</script>

<template>
  <aside
    class="flex h-full w-80 shrink-0 flex-col border-l border-border bg-bg"
    aria-label="Archivos de la sesión"
  >
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
      <template v-if="current">
        <IconButton :icon="ArrowLeft" label="Volver a la lista" @click="store.reset()" />
        <h2 class="min-w-0 flex-1 truncate font-mono text-[13px]" :title="title" dir="rtl">
          <bdi>{{ title }}</bdi>
        </h2>
      </template>
      <div v-else class="flex flex-1 gap-0.5" role="tablist" aria-label="Lista de archivos">
        <button
          v-for="l in lists"
          :key="l.id"
          type="button"
          role="tab"
          :aria-selected="store.list === l.id"
          class="rounded-item px-2 py-1 text-sm transition-colors duration-150"
          :class="
            store.list === l.id
              ? 'bg-surface-hover font-medium text-text'
              : 'text-muted hover:text-text'
          "
          @click="store.list = l.id"
        >
          {{ l.label }}
          <span class="text-xs text-muted tabular-nums">
            ({{ l.id === 'session' ? files.length : changes.length }})
          </span>
        </button>
      </div>
      <IconButton :icon="X" label="Cerrar el panel de archivos" @click="emit('close')" />
    </header>

    <FileDetail
      v-if="current"
      :target="{ sessionId }"
      :path="current.path"
      :source="current.source"
      :session-file="current.sessionFile"
      :git-change="current.gitChange"
      :cwd="cwd"
    />

    <template v-else-if="store.list === 'session'">
      <p v-if="files.length === 0" class="p-4 text-sm text-muted">
        Esta sesión aún no ha creado ni editado archivos.
      </p>
      <ul v-else class="min-h-0 flex-1 overflow-y-auto p-1" role="tabpanel">
        <li v-for="file in files" :key="file.key">
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
            :title="`${STATUS[file.status].label}: ${file.path}`"
            @click="selectSession(file)"
          >
            <component
              :is="STATUS[file.status].icon"
              class="shrink-0"
              :class="STATUS[file.status].tone"
              :size="16"
              :stroke-width="1.75"
              :aria-label="STATUS[file.status].label"
            />
            <span class="min-w-0 flex-1 truncate font-mono text-[13px]" dir="rtl">
              <bdi>{{ file.path }}</bdi>
            </span>
            <span v-if="file.changes.length > 0" class="shrink-0 text-xs tabular-nums">
              <span class="text-diff-add">+{{ file.added }}</span>
              <span class="ml-1 text-diff-del">−{{ file.removed }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <p v-if="!status" class="p-4 text-sm text-muted">
        {{ git.loading ? 'Consultando Git…' : 'Esta carpeta no es un repositorio Git.' }}
      </p>
      <p v-else-if="changes.length === 0" class="p-4 text-sm text-muted">
        Sin cambios en el repositorio.
      </p>
      <ul v-else class="min-h-0 flex-1 overflow-y-auto p-1" role="tabpanel">
        <li v-for="change in changes" :key="change.path">
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2 rounded-item px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
            :title="`${gitChangeLabel(change)}: ${change.path}`"
            @click="selectGit(change)"
          >
            <span
              class="w-4 shrink-0 text-center font-mono text-xs font-semibold"
              :class="gitChangeTone(change.kind)"
              :aria-label="gitChangeLabel(change)"
              >{{ gitChangeLetter(change.kind) }}</span
            >
            <span class="min-w-0 flex-1 truncate font-mono text-[13px]" dir="rtl">
              <bdi>{{ change.path }}</bdi>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </aside>
</template>
