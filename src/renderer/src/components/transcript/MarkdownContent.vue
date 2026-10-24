<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useHighlight } from '../../composables/useHighlight'
import { renderMarkdown } from '../../lib/markdown'

/**
 * Markdown del asistente con código resaltado de forma diferida. En
 * streaming se vuelve a renderizar como mucho una vez por marco y sin resaltar
 * hasta que el texto está completo.
 */
const props = defineProps<{
  source: string
  streaming?: boolean
}>()

const root = ref<HTMLElement | null>(null)
const shown = ref(props.source)
let frame = 0
watch(
  () => props.source,
  (source) => {
    if (!props.streaming) {
      cancelAnimationFrame(frame)
      frame = 0
      shown.value = source
      return
    }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      shown.value = props.source
    })
  }
)
onBeforeUnmount(() => cancelAnimationFrame(frame))
const html = computed(() => renderMarkdown(shown.value))
useHighlight(root, html, () => !props.streaming)

// Botones «Copiar» de los bloques de código (generados por `renderMarkdown`): por delegación.
async function onClick(event: MouseEvent): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]')
  const code = button?.closest('.code-block')?.querySelector('code')?.textContent
  if (!button || code == null) return
  try {
    await navigator.clipboard.writeText(code)
    button.textContent = t('Copiado')
    setTimeout(() => (button.textContent = t('Copiar')), 1500)
  } catch (error) {
    console.error('No se pudo copiar el código:', error)
  }
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown-it con `html: false`: el HTML del mensaje llega escapado. -->
  <div ref="root" class="markdown" @click="onClick" v-html="html" />
</template>
