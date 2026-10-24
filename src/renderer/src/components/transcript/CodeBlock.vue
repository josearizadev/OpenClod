<script setup lang="ts">
import { t } from '../../i18n'
import { computed, ref } from 'vue'
import { useCopy } from '../../composables/useCopy'
import { useHighlight } from '../../composables/useHighlight'

/**
 * Bloque de código suelto (contenido de `Write`, comandos, JSON de herramientas), con la misma
 * cabecera que los del Markdown y resaltado diferido. `lang` vacío o `text` = sin resaltar.
 */
const props = defineProps<{
  code: string
  lang?: string
  /** Texto de la cabecera; por defecto, el lenguaje. */
  label?: string
}>()

const root = ref<HTMLElement | null>(null)
const highlightable = computed(() => (props.lang && props.lang !== 'text' ? props.lang : undefined))
useHighlight(root, () => [props.code, props.lang])

const { copied, copy } = useCopy()
</script>

<template>
  <div ref="root" class="code-block">
    <div class="code-block-header">
      <span class="min-w-0 truncate" :title="label">{{ label ?? lang ?? 'texto' }}</span>
      <button type="button" class="code-copy shrink-0" @click="copy(code)">
        {{ copied ? t('Copiado') : t('Copiar') }}
      </button>
    </div>
    <pre><code :key="code + (lang ?? '')" :data-lang="highlightable">{{ code }}</code></pre>
  </div>
</template>
