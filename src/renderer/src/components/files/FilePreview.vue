<script setup lang="ts">
import { t } from '../../i18n'
import { computed, ref, watch } from 'vue'
import type { FilePreview } from '../../../../shared/files'
import { formatBytes } from '../../lib/files'
import MarkdownContent from '../transcript/MarkdownContent.vue'
import CodeBlock from '../transcript/CodeBlock.vue'

/**
 * Contenido actual de un archivo: Markdown renderizado
 * (o su código), imagen, código resaltado o el motivo por el que no se muestra.
 */
const props = defineProps<{ preview: FilePreview }>()

const showSource = ref(false)
watch(
  () => props.preview.path,
  () => (showSource.value = false)
)

const name = computed(() => props.preview.path.replace(/^.*\//, ''))

const NOTICE: Partial<Record<FilePreview['kind'], string>> = {
  missing: t('El archivo ya no existe.'),
  secret: t('Vista previa desactivada: puede contener secretos.'),
  outside: t('El archivo está fuera de la carpeta de la sesión.'),
  binary: t('Archivo binario: no se puede mostrar.'),
  'too-large': t('Archivo demasiado grande para la vista previa.')
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <template v-if="preview.kind === 'markdown'">
      <div class="flex gap-0.5 self-start rounded-item bg-surface-hover p-0.5" role="tablist">
        <button
          v-for="option in [
            { source: false, label: t('Vista previa') },
            { source: true, label: t('Código') }
          ]"
          :key="option.label"
          type="button"
          role="tab"
          :aria-selected="showSource === option.source"
          class="rounded-[6px] px-2 py-0.5 text-xs transition-colors duration-150"
          :class="showSource === option.source ? 'bg-surface text-text shadow-float' : 'text-muted'"
          @click="showSource = option.source"
        >
          {{ option.label }}
        </button>
      </div>
      <CodeBlock v-if="showSource" :code="preview.text" lang="markdown" :label="name" />
      <MarkdownContent v-else :source="preview.text" class="min-w-0 text-sm" />
    </template>

    <CodeBlock
      v-else-if="preview.kind === 'text'"
      :code="preview.text"
      :lang="preview.lang"
      :label="name"
    />

    <figure
      v-else-if="preview.kind === 'image'"
      class="flex flex-col items-center gap-2 rounded-item bg-code-bg p-3"
    >
      <img :src="preview.dataUrl" :alt="name" class="max-h-[60vh] max-w-full object-contain" />
      <figcaption class="text-xs text-muted">{{ formatBytes(preview.size) }}</figcaption>
    </figure>

    <p v-else class="py-2 text-sm text-muted">
      {{ NOTICE[preview.kind] }}
      <template v-if="'size' in preview"> ({{ formatBytes(preview.size) }})</template>
    </p>

    <p
      v-if="(preview.kind === 'text' || preview.kind === 'markdown') && preview.truncated"
      class="text-xs text-muted"
    >
      {{ t('Se muestra el primer MB de {size}.', { size: formatBytes(preview.size) }) }}
    </p>
  </div>
</template>
