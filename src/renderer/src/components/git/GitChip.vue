<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { FolderPlus, GitBranch, RefreshCw } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { GitFileChange } from '../../../../shared/git'
import { gitChangeLabel, gitChangeLetter, gitChangeTone } from '../../lib/git'
import { useFilesStore } from '../../stores/files'
import { useGitStore } from '../../stores/git'
import { useProjectsStore } from '../../stores/projects'
import IconButton from '../ui/IconButton.vue'

/**
 * Chip de Git de la cabecera: rama, ↑↓ y nº de
 * cambios; al pulsarlo, la lista de cambios y los worktrees.
 */
const git = useGitStore()
const files = useFilesStore()
const projects = useProjectsStore()
const open = ref(false)

const status = computed(() => git.info?.status ?? null)
const branch = computed(() => {
  const s = status.value
  if (!s) return ''
  if (s.branch) return s.branch
  return s.head ? `HEAD separado · ${s.head}` : 'HEAD separado'
})
const shortBranch = computed(() =>
  branch.value.length > 24 ? `${branch.value.slice(0, 23)}…` : branch.value
)
const count = computed(() => status.value?.files.length ?? 0)
const inSession = computed(() => !!git.target && 'sessionId' in git.target)

const SHOWN = 200
const shown = computed(() => status.value?.files.slice(0, SHOWN) ?? [])
const hidden = computed(() => count.value - shown.value.length)

const summary = computed(() => {
  const s = status.value
  if (!s) return ''
  const parts = [`Rama ${branch.value}`]
  if (s.ahead) parts.push(`${s.ahead} por delante`)
  if (s.behind) parts.push(`${s.behind} por detrás`)
  parts.push(count.value === 1 ? '1 archivo con cambios' : `${count.value} archivos con cambios`)
  return parts.join(', ')
})

function pick(change: GitFileChange): void {
  if (!status.value || !inSession.value) return
  files.openGit(status.value.root, change.path)
  open.value = false
}

async function importWorktree(path: string): Promise<void> {
  await projects.importPath(path)
  await git.reload()
}
</script>

<template>
  <PopoverRoot v-if="status" v-model:open="open">
    <PopoverTrigger
      class="no-drag mr-auto inline-flex h-7 max-w-[40%] min-w-0 items-center gap-1.5 rounded-item px-2 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      :aria-label="summary"
      :title="summary"
    >
      <GitBranch :size="14" :stroke-width="1.75" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate font-medium">{{ shortBranch }}</span>
      <span v-if="status.ahead || status.behind" class="shrink-0 tabular-nums">
        <template v-if="status.ahead">↑{{ status.ahead }}</template>
        <template v-if="status.behind">↓{{ status.behind }}</template>
      </span>
      <span v-if="count" class="flex shrink-0 items-center gap-1 tabular-nums">
        <span class="size-1.5 rounded-full bg-warning" aria-hidden="true" />
        {{ status.truncated ? `${count}+` : count }}
      </span>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        align="start"
        :side-offset="6"
        :collision-padding="8"
        class="z-30 flex max-h-[min(32rem,calc(100vh-5rem))] w-[26rem] max-w-[calc(100vw-1rem)] flex-col rounded-menu bg-surface text-text shadow-float"
      >
        <header class="flex items-center gap-2 border-b border-border px-3 py-2">
          <GitBranch :size="16" :stroke-width="1.75" class="shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium" :title="branch">{{ branch }}</p>
            <p class="truncate text-xs text-muted">
              <template v-if="status.upstream">
                {{ status.upstream }}
                <template v-if="status.ahead || status.behind">
                  · {{ status.ahead }} por delante · {{ status.behind }} por detrás
                </template>
                <template v-else> · al día</template>
              </template>
              <template v-else>Sin rama remota</template>
            </p>
          </div>
          <IconButton
            :icon="RefreshCw"
            label="Actualizar"
            :class="git.loading ? '[&_svg]:animate-spin' : ''"
            @click="git.reload()"
          />
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-1">
          <p v-if="count === 0" class="px-2 py-3 text-sm text-muted">Sin cambios.</p>
          <ul v-else :aria-label="`${count} archivos con cambios`">
            <li v-for="change in shown" :key="change.path">
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-2 rounded-item px-2 py-1 text-left text-sm enabled:hover:bg-surface-hover disabled:cursor-default"
                :disabled="!inSession"
                :title="
                  inSession
                    ? `${gitChangeLabel(change)}: ${change.path}`
                    : `${gitChangeLabel(change)}: ${change.path} (abre una sesión para ver el diff)`
                "
                @click="pick(change)"
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
                <span v-if="change.staged" class="shrink-0 text-xs text-muted">preparado</span>
              </button>
            </li>
          </ul>
          <p v-if="hidden > 0 || status.truncated" class="px-2 py-1 text-xs text-muted">
            Y {{ status.truncated ? 'más de ' : '' }}{{ hidden }} más…
          </p>
        </div>

        <footer
          v-if="git.info && git.info.worktrees.length > 1"
          class="border-t border-border p-1"
          aria-label="Worktrees"
        >
          <p class="px-2 pt-1 pb-0.5 text-xs font-medium text-muted">Worktrees</p>
          <div
            v-for="tree in git.info.worktrees"
            :key="tree.path"
            class="flex min-w-0 items-center gap-2 px-2 py-1 text-sm"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate font-mono text-[13px]" :title="tree.path">{{
                tree.path
              }}</span>
              <span class="block truncate text-xs text-muted">
                {{ tree.bare ? 'bare' : (tree.branch ?? `HEAD separado · ${tree.head ?? ''}`) }}
              </span>
            </span>
            <span v-if="tree.current" class="shrink-0 text-xs font-medium text-accent">Actual</span>
            <button
              v-else-if="!tree.projectId && !tree.bare"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-item px-2 py-1 text-xs hover:bg-surface-hover"
              @click="importWorktree(tree.path)"
            >
              <FolderPlus :size="14" :stroke-width="1.75" aria-hidden="true" />
              Importar como proyecto
            </button>
          </div>
        </footer>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
