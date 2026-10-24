<script setup lang="ts">
import { t } from '../../i18n'
import { Check, ChevronDown } from 'lucide-vue-next'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed } from 'vue'
import type { ChatModel } from '../../../../shared/chat'

/**
 * Selector de modelo con la lista que da el SDK (`supportedModels`,
 * guardada en la caché). `null` = el que use Claude Code por defecto. Se aplica al siguiente turno.
 */
const props = defineProps<{
  models: ChatModel[]
  disabled?: boolean
}>()

const model = defineModel<string | null>({ required: true })

/** Un id completo (`claude-haiku-…`) se reconoce por el alias que lo resuelve. */
function find(value: string | null): ChatModel | undefined {
  if (!value) return undefined
  return (
    props.models.find((m) => m.value === value) ??
    props.models.find((m) => m.value !== 'default' && m.resolvedModel === value)
  )
}

const label = computed(() => {
  const found = find(model.value)
  if (found) return found.displayName
  if (model.value) return model.value.replace(/^claude-/, '')
  return t('Predeterminado')
})

const options = computed(() => props.models.filter((m) => m.value !== 'default'))

const itemClass =
  'flex min-h-8 cursor-default items-start gap-2 rounded-item px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      :disabled="disabled"
      class="inline-flex h-8 max-w-48 items-center gap-1 rounded-item px-2 text-sm text-muted transition-colors duration-150 enabled:hover:bg-surface-hover enabled:hover:text-text disabled:opacity-60"
      :aria-label="t('Modelo: {model}', { model: label })"
    >
      <span class="truncate">{{ label }}</span>
      <ChevronDown class="shrink-0" :size="14" :stroke-width="1.75" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        side="top"
        :side-offset="6"
        :collision-padding="8"
        class="z-30 max-h-96 w-72 overflow-y-auto rounded-menu bg-surface p-1 text-text shadow-float"
      >
        <DropdownMenuItem :class="itemClass" @select="model = null">
          <span class="flex min-w-0 flex-1 flex-col">
            <span>{{ t('Predeterminado') }}</span>
            <span class="text-xs text-muted">{{ t('El que use Claude Code') }}</span>
          </span>
          <Check v-if="model === null" class="mt-0.5 shrink-0" :size="16" aria-hidden="true" />
        </DropdownMenuItem>
        <DropdownMenuItem
          v-for="option in options"
          :key="option.value"
          :class="itemClass"
          @select="model = option.value"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span>{{ option.displayName }}</span>
            <span v-if="option.description" class="line-clamp-2 text-xs text-muted">{{
              option.description
            }}</span>
          </span>
          <Check
            v-if="find(model)?.value === option.value"
            class="mt-0.5 shrink-0"
            :size="16"
            aria-hidden="true"
          />
        </DropdownMenuItem>
        <p v-if="options.length === 0" class="px-2 py-1.5 text-xs text-muted">
          {{ t('La lista de modelos aparece tras la primera sesión.') }}
        </p>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
