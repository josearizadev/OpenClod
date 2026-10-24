<script setup lang="ts">
import { t } from '../../i18n'
import { Bot, ChevronDown, LoaderCircle, SquareTerminal, Wrench } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue'
import type { TaskView } from '../../../../shared/chat'
import { formatDuration } from '../../lib/dates'

/**
 * Tareas y subagentes en segundo plano: indicador compacto
 * encima del compositor y, al desplegarlo, una fila por tarea con su estado, tiempo, último
 * progreso y **Detener**. Desaparece cuando no queda ninguna.
 */
const props = defineProps<{ tasks: TaskView[] }>()
const emit = defineEmits<{ stop: [taskId: string]; open: [toolUseId: string] }>()

const open = ref(false)
const running = computed(() => props.tasks.filter((t) => t.status === 'running'))

// Reloj de un segundo solo mientras haya tareas en curso.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
watch(
  () => running.value.length > 0,
  (active) => {
    if (active && !timer) timer = setInterval(() => (now.value = Date.now()), 1000)
    if (!active && timer) {
      clearInterval(timer)
      timer = null
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => timer && clearInterval(timer))

const ICONS: Record<TaskView['type'], Component> = {
  agent: Bot,
  bash: SquareTerminal,
  other: Wrench
}

const STATUS: Record<TaskView['status'], string> = {
  running: t('En curso'),
  completed: t('Terminada'),
  failed: t('Fallida'),
  stopped: t('Detenida')
}

function elapsed(task: TaskView): string {
  return formatDuration((task.endedAt ?? now.value) - task.startedAt)
}

const label = computed(() => {
  const n = running.value.length
  if (n === 0) return t('Tareas en segundo plano terminadas')
  return n === 1 ? t('1 tarea en segundo plano') : t('{n} tareas en segundo plano', { n })
})
</script>

<template>
  <div v-if="tasks.length > 0" class="flex flex-col gap-1 text-sm">
    <button
      type="button"
      class="flex w-fit items-center gap-1.5 rounded-item px-2 py-1 text-muted hover:text-text"
      :aria-expanded="open"
      @click="open = !open"
    >
      <LoaderCircle
        v-if="running.length > 0"
        class="motion-safe:animate-spin motion-safe:[animation-duration:2s]"
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      <span>{{ label }}</span>
      <ChevronDown
        :size="14"
        :stroke-width="1.75"
        aria-hidden="true"
        class="transition-transform duration-150 motion-reduce:transition-none"
        :class="open ? 'rotate-180' : ''"
      />
    </button>
    <ul
      v-if="open"
      class="flex flex-col gap-1 rounded-menu bg-surface p-2 shadow-float"
      :aria-label="t('Tareas en segundo plano')"
    >
      <li
        v-for="task in tasks"
        :key="task.taskId"
        class="flex min-w-0 items-center gap-2 rounded-item px-2 py-1"
      >
        <component
          :is="ICONS[task.type]"
          class="shrink-0 text-muted"
          :size="16"
          :stroke-width="1.75"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            class="min-w-0 truncate text-left hover:underline disabled:hover:no-underline"
            :disabled="!task.toolUseId"
            :title="task.description"
            @click="task.toolUseId && emit('open', task.toolUseId)"
          >
            <span v-if="task.subagentType" class="text-muted">{{ task.subagentType }} · </span
            >{{ task.description || t('Tarea') }}
          </button>
          <span class="min-w-0 truncate text-xs text-muted">
            <span
              :class="
                task.status === 'failed'
                  ? 'text-danger'
                  : task.status === 'running'
                    ? 'text-accent'
                    : ''
              "
              >{{ STATUS[task.status] }}</span
            >
            · {{ elapsed(task) }}
            <template v-if="task.lastProgress"> · {{ task.lastProgress }}</template>
          </span>
        </div>
        <button
          v-if="task.status === 'running'"
          type="button"
          class="h-7 shrink-0 rounded-item px-2 text-xs text-muted hover:bg-surface-hover hover:text-text"
          @click="emit('stop', task.taskId)"
        >
          {{ t('Detener') }}
        </button>
      </li>
    </ul>
  </div>
</template>
