<script setup lang="ts">
import { t } from '../../i18n'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { BookText, Eye, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { estimateTokens, type ComposedContext } from '../../../../shared/context'
import { formatTokens } from '../../lib/tokens'
import SettingSwitch from '../settings/SettingSwitch.vue'
import MarkdownContent from '../transcript/MarkdownContent.vue'

/**
 * Bienvenida: el contexto de OpenClod que recibirá la sesión (archivos del proyecto y carpeta),
 * con su tamaño, «Ver» para leerlo entero y un interruptor para no enviarlo esta vez.
 */
const props = defineProps<{ context: ComposedContext; readonly?: boolean }>()
/** Se envía en la próxima sesión. */
const enabled = defineModel<boolean>({ required: true })

const open = ref(false)

const files = computed(() => props.context.parts.filter((p) => p.kind === 'file').length)
const folder = computed(() => props.context.parts.find((p) => p.kind === 'folder') ?? null)
const summary = computed(() => {
  const parts: string[] = []
  if (files.value > 0)
    parts.push(files.value === 1 ? t('1 archivo') : t('{n} archivos', { n: files.value }))
  if (folder.value) parts.push(t('carpeta'))
  parts.push(
    t('≈ {tokens} tokens', {
      tokens: formatTokens(estimateTokens(Math.min(props.context.chars, props.context.text.length)))
    })
  )
  return parts.join(' · ')
})
</script>

<template>
  <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm text-muted">
    <BookText :size="16" :stroke-width="1.75" class="shrink-0" aria-hidden="true" />
    <span class="truncate" :class="enabled ? '' : 'line-through'">
      {{ t('Contexto: {summary}', { summary }) }}
    </span>
    <span v-if="context.truncated && enabled" class="shrink-0 text-warning">
      {{ t('(recortado)') }}
    </span>
    <button
      type="button"
      :aria-label="t('Ver el contexto')"
      :title="t('Ver el contexto')"
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-item transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      @click="open = true"
    >
      <Eye :size="14" :stroke-width="1.75" />
    </button>
    <SettingSwitch
      v-model="enabled"
      :disabled="readonly"
      :label="t('Enviar el contexto en esta sesión')"
    />

    <DialogRoot v-model:open="open">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
        <DialogContent
          class="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog bg-surface p-5 text-text shadow-float"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <DialogTitle class="font-serif text-lg">{{ t('Contexto de la sesión') }}</DialogTitle>
              <DialogDescription class="mt-1 text-sm text-muted">
                {{
                  t(
                    'Se añade a las instrucciones de Claude Code al empezar la sesión y se mantiene al continuarla.'
                  )
                }}
              </DialogDescription>
            </div>
            <DialogClose
              :aria-label="t('Cerrar')"
              class="inline-flex size-8 items-center justify-center rounded-item text-muted hover:bg-surface-hover hover:text-text"
            >
              <X :size="16" :stroke-width="1.75" />
            </DialogClose>
          </div>
          <ul class="mt-3 flex flex-wrap gap-1.5 text-xs">
            <li
              v-for="part in context.parts"
              :key="part.kind + part.name"
              class="rounded-full bg-surface-hover px-2 py-0.5"
            >
              {{ part.kind === 'folder' ? t('Carpeta «{name}»', { name: part.name }) : part.name }}
            </li>
          </ul>
          <div class="mt-3 min-h-0 flex-1 overflow-y-auto rounded-item border border-border p-3">
            <MarkdownContent :source="context.text.replace(/<\/?openclod-context>/g, '').trim()" />
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
