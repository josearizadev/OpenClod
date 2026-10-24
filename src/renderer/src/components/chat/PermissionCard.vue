<script setup lang="ts">
import { t } from '../../i18n'
import { ChevronDown, ShieldQuestion } from 'lucide-vue-next'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { PermissionRequestView } from '../../../../shared/chat'
import type { ToolCallView } from '../../lib/transcript/blocks'
import { permissionVerb, toolSummary } from '../../lib/transcript/tools'
import CommandOutput from '../transcript/tools/CommandOutput.vue'
import EditDiff from '../transcript/tools/EditDiff.vue'
import GenericTool from '../transcript/tools/GenericTool.vue'
import WriteContent from '../transcript/tools/WriteContent.vue'

/**
 * Petición de permiso en línea en el transcript: herramienta,
 * argumento principal, motivo y vista previa con los componentes del visor; **Permitir una vez**,
 * **Permitir siempre** (en la sesión o en el proyecto, con las reglas que se añaden) y **Denegar**
 * con un motivo opcional que recibe Claude.
 */
const props = defineProps<{
  request: PermissionRequestView
  cwd?: string
  /** Llevar el foco a la tarjeta al aparecer (el compositor está vacío). */
  autofocus?: boolean
}>()

const emit = defineEmits<{
  allow: []
  always: [scope: 'session' | 'project']
  deny: [message: string]
}>()

const summary = computed(() => toolSummary(props.request.toolName, props.request.input, props.cwd))
const verb = computed(() => permissionVerb(props.request.toolName))

/** La tarjeta usa los componentes del visor con una llamada aún sin resultado. */
const call = computed<ToolCallView>(() => ({
  id: props.request.toolUseId ?? props.request.requestId,
  name: props.request.toolName,
  input: props.request.input,
  status: 'running'
}))

type Preview = 'edit' | 'write' | 'command' | 'generic'
const preview = computed<Preview>(() => {
  switch (props.request.toolName) {
    case 'Edit':
    case 'MultiEdit':
      return 'edit'
    case 'Write':
      return 'write'
    case 'Bash':
    case 'PowerShell':
      return 'command'
    default:
      return 'generic'
  }
})

const denying = ref(false)
const reason = ref('')
const reasonInput = useTemplateRef<HTMLInputElement>('reasonInput')
const allowButton = useTemplateRef<HTMLButtonElement>('allowButton')

async function startDeny(): Promise<void> {
  denying.value = true
  await nextTick()
  reasonInput.value?.focus()
}

function deny(): void {
  emit('deny', reason.value.trim())
}

onMounted(() => {
  if (props.autofocus) allowButton.value?.focus({ preventScroll: true })
})

const itemClass =
  'flex min-h-8 cursor-default flex-col items-start gap-0.5 rounded-item px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-menu border border-border bg-surface p-4 shadow-float"
    :aria-label="t('Petición de permiso')"
    @keydown.enter.self.prevent="emit('allow')"
  >
    <header class="flex items-start gap-2">
      <ShieldQuestion
        class="mt-0.5 shrink-0 text-accent"
        :size="18"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-col gap-0.5">
        <p v-if="request.title" class="text-sm">{{ request.title }}</p>
        <p v-else class="text-sm">
          {{ t('Claude quiere') }} <strong>{{ verb }}</strong>
          <code v-if="summary" class="ml-1 font-mono text-[13px]">{{ summary }}</code>
          <span v-else class="ml-1 font-medium">{{ request.toolName }}</span>
        </p>
        <p v-if="request.description && request.title" class="text-xs text-muted">
          {{ request.description }}
        </p>
        <p v-if="request.decisionReason" class="text-xs text-muted">
          {{ request.decisionReason }}
        </p>
        <p v-if="request.blockedPath" class="text-xs text-muted">
          {{ t('Ruta bloqueada:') }} <code class="font-mono">{{ request.blockedPath }}</code>
        </p>
      </div>
    </header>

    <div class="flex max-h-80 min-w-0 flex-col gap-2 overflow-auto">
      <EditDiff v-if="preview === 'edit'" :call="call" />
      <WriteContent v-else-if="preview === 'write'" :call="call" :cwd="cwd" />
      <CommandOutput v-else-if="preview === 'command'" :call="call" />
      <GenericTool v-else :call="call" show-input />
    </div>

    <form v-if="denying" class="flex items-center gap-2" @submit.prevent="deny">
      <input
        ref="reasonInput"
        v-model="reason"
        maxlength="2000"
        :aria-label="t('Motivo (opcional)')"
        :placeholder="t('Motivo para Claude (opcional)')"
        class="h-8 min-w-0 flex-1 rounded-item border border-border bg-bg px-2 text-sm outline-none placeholder:text-muted focus-visible:border-accent"
        @keydown.esc.prevent="denying = false"
      />
      <button
        type="submit"
        class="h-8 shrink-0 rounded-item bg-danger px-3 text-sm text-on-accent hover:opacity-90"
      >
        {{ t('Denegar') }}
      </button>
      <button
        type="button"
        class="h-8 shrink-0 rounded-item px-2 text-sm text-muted hover:bg-surface-hover hover:text-text"
        @click="denying = false"
      >
        {{ t('Cancelar') }}
      </button>
    </form>

    <div v-else class="flex flex-wrap items-center gap-2">
      <button
        ref="allowButton"
        type="button"
        class="h-8 rounded-item bg-accent px-3 text-sm text-on-accent transition-colors duration-150 hover:bg-accent-hover"
        @click="emit('allow')"
      >
        {{ t('Permitir una vez') }}
      </button>
      <DropdownMenuRoot v-if="!request.noAlways && request.alwaysLabels.length > 0">
        <DropdownMenuTrigger
          class="inline-flex h-8 items-center gap-1 rounded-item border border-border px-3 text-sm transition-colors duration-150 hover:bg-surface-hover"
        >
          {{ t('Permitir siempre') }}
          <ChevronDown :size="14" :stroke-width="1.75" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="start"
            :side-offset="4"
            :collision-padding="8"
            class="z-30 w-80 rounded-menu bg-surface p-1 text-text shadow-float"
          >
            <DropdownMenuLabel class="px-2 py-1 text-xs text-muted">
              {{ t('Se añade: {rules}', { rules: request.alwaysLabels.join(', ') }) }}
            </DropdownMenuLabel>
            <DropdownMenuItem :class="itemClass" @select="emit('always', 'session')">
              <span>{{ t('En esta sesión') }}</span>
              <span class="text-xs text-muted">{{
                t('Hasta que se cierre; no se guarda nada')
              }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem :class="itemClass" @select="emit('always', 'project')">
              <span>{{ t('En este proyecto') }}</span>
              <span class="text-xs text-muted"
                >{{ t('Claude Code lo guarda en') }} <code>.claude/settings.local.json</code></span
              >
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <button
        type="button"
        class="h-8 rounded-item px-3 text-sm text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
        @click="startDeny"
      >
        {{ t('Denegar') }}
      </button>
    </div>
  </section>
</template>
