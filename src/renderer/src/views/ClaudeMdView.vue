<script setup lang="ts">
import { FilePlus, Pencil, RotateCcw, Save, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, type RouteLocationRaw } from 'vue-router'
import { useRouter } from 'vue-router'
import type { ClaudeMdFile } from '../../../shared/files'
import MarkdownContent from '../components/transcript/MarkdownContent.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { changeCounts } from '../lib/transcript/files'
import { useProjectsStore } from '../stores/projects'
import { useUiStore } from '../stores/ui'

/**
 * `CLAUDE.md` del proyecto: lectura renderizada, edición con confirmación
 * y sin pisar los cambios que haga Claude mientras tanto.
 */
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const projects = useProjectsStore()

const projectId = computed(() => String(route.params['id'] ?? ''))
const project = computed(() => projects.projects.find((p) => p.id === projectId.value) ?? null)

const file = ref<ClaudeMdFile | null>(null)
const error = ref<string | null>(null)
const editing = ref(false)
const draft = ref('')
const conflict = ref<ClaudeMdFile | null>(null)
const confirmOpen = ref(false)
const saving = ref(false)

const dirty = computed(
  () => editing.value && file.value !== null && draft.value !== file.value.text
)
const counts = computed(() =>
  changeCounts('Edit', { old_string: file.value?.text ?? '', new_string: draft.value })
)

async function load(): Promise<void> {
  error.value = null
  const result = await window.api.claudeMd.read(projectId.value)
  if (!result.ok) {
    error.value = result.error.message
    file.value = null
    return
  }
  file.value = result.data
  if (!editing.value) draft.value = result.data.text
}

watch(projectId, () => {
  editing.value = false
  conflict.value = null
  void load()
})
onMounted(() => {
  ui.pageTitle = 'Instrucciones del proyecto'
  void load()
})
onBeforeUnmount(() => (ui.pageTitle = null))

function edit(): void {
  draft.value = file.value?.text ?? ''
  conflict.value = null
  editing.value = true
}

function cancel(): void {
  editing.value = false
  conflict.value = null
  draft.value = file.value?.text ?? ''
}

async function save(): Promise<void> {
  if (!file.value) return
  saving.value = true
  const result = await window.api.claudeMd.write({
    projectId: projectId.value,
    text: draft.value,
    expectedHash: file.value.hash
  })
  saving.value = false
  if (!result.ok) {
    ui.toast(`No se pudo guardar: ${result.error.message}`, { tone: 'danger' })
    return
  }
  if (!result.data.ok) {
    conflict.value = result.data.file
    return
  }
  file.value = result.data.file
  editing.value = false
  ui.toast('CLAUDE.md guardado')
}

/** Recargar lo de disco: se pierde lo editado. */
function reloadFromDisk(): void {
  if (!conflict.value) return
  file.value = conflict.value
  draft.value = conflict.value.text
  conflict.value = null
}

async function copyDraft(): Promise<void> {
  try {
    await navigator.clipboard.writeText(draft.value)
    ui.toast('Tu versión está en el portapapeles')
  } catch {
    ui.toast('No se pudo copiar', { tone: 'danger' })
  }
}

/** Salir con cambios sin guardar pide confirmación. */
const leaveOpen = ref(false)
let pending: RouteLocationRaw | null = null
onBeforeRouteLeave((to) => {
  if (!dirty.value || pending) return true
  pending = to.fullPath
  leaveOpen.value = true
  return false
})
function leave(): void {
  const to = pending
  editing.value = false
  if (to) void router.push(to).finally(() => (pending = null))
}
watch(leaveOpen, (open) => {
  if (!open && pending) setTimeout(() => (pending = null), 0)
})
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-chat flex-col px-6 py-6">
    <header class="mb-4 flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-serif text-2xl">CLAUDE.md</h2>
        <p class="truncate font-mono text-xs text-muted" :title="file?.path">
          {{ file?.path ?? project?.path ?? '' }}
        </p>
      </div>
      <template v-if="file?.exists || editing">
        <template v-if="editing">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item px-3 text-sm hover:bg-surface-hover"
            @click="cancel"
          >
            <X :size="16" :stroke-width="1.75" aria-hidden="true" /> Cancelar
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
            :disabled="!dirty || saving"
            @click="confirmOpen = true"
          >
            <Save :size="16" :stroke-width="1.75" aria-hidden="true" /> Guardar
          </button>
        </template>
        <button
          v-else
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-item border border-border px-3 text-sm hover:bg-surface-hover"
          @click="edit"
        >
          <Pencil :size="16" :stroke-width="1.75" aria-hidden="true" /> Editar
        </button>
      </template>
    </header>

    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>

    <div
      v-else-if="conflict"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-item border border-warning px-3 py-2 text-sm"
      role="alert"
    >
      <span class="min-w-0 flex-1">
        CLAUDE.md ha cambiado en disco desde que lo abriste (quizá lo editó Claude). No se ha
        guardado nada.
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-item px-2 py-1 hover:bg-surface-hover"
        @click="copyDraft"
      >
        Copiar mi versión
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-item px-2 py-1 font-medium text-accent hover:bg-surface-hover"
        @click="reloadFromDisk"
      >
        <RotateCcw :size="14" :stroke-width="1.75" aria-hidden="true" /> Recargar
      </button>
    </div>

    <div
      v-if="!error && file && !file.exists && !editing"
      class="flex flex-col items-start gap-3 py-8"
    >
      <p class="text-muted">
        Este proyecto no tiene <code class="font-mono">CLAUDE.md</code>. Claude Code lo lee al
        empezar cada sesión: sirve para dejarle instrucciones del proyecto.
      </p>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-item bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover"
        @click="edit"
      >
        <FilePlus :size="16" :stroke-width="1.75" aria-hidden="true" /> Crear CLAUDE.md
      </button>
    </div>

    <textarea
      v-else-if="editing"
      v-model="draft"
      class="min-h-0 w-full flex-1 resize-none rounded-item border border-border bg-surface p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
      aria-label="Contenido de CLAUDE.md"
      spellcheck="false"
    />

    <div v-else-if="file?.exists" class="min-h-0 flex-1 overflow-y-auto">
      <MarkdownContent :source="file.text" />
    </div>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="¿Guardar CLAUDE.md?"
      :description="`Se escribirá el archivo del proyecto: +${counts.added} −${counts.removed} líneas.`"
      confirm-label="Guardar"
      @confirm="save"
    />
    <ConfirmDialog
      v-model:open="leaveOpen"
      title="¿Descartar los cambios?"
      description="Tienes cambios sin guardar en CLAUDE.md."
      confirm-label="Descartar"
      danger
      @confirm="leave"
    />
  </div>
</template>
