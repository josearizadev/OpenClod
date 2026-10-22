<script setup lang="ts">
import { Image } from 'lucide-vue-next'
import MessageActions from '../transcript/MessageActions.vue'

const props = defineProps<{
  text: string
  /** Imágenes adjuntas: solo el número, su contenido no está disponible. */
  images?: number
  timestamp?: string
  /** Entregado pero aún no recibido por Claude: atenuado y sin acciones. */
  pending?: boolean
}>()
</script>

<template>
  <!-- Burbuja a la derecha, sans 16 px, texto tal cual. Acciones al pasar o con foco. -->
  <div class="group relative flex flex-col items-end">
    <div
      class="max-w-[80%] rounded-bubble bg-bubble-user px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap transition-opacity duration-300 [overflow-wrap:anywhere] motion-reduce:transition-none"
      :class="props.pending ? 'opacity-50' : ''"
    >
      <span
        v-if="props.images"
        class="mb-1 flex items-center gap-1.5 text-sm whitespace-normal text-muted"
      >
        <Image :size="14" :stroke-width="1.75" aria-hidden="true" />
        {{ props.images === 1 ? '1 imagen' : `${props.images} imágenes` }}
      </span>
      <!-- `v-text`: sin los espacios de la plantilla, que `pre-wrap` mostraría. -->
      <span v-text="props.text" />
    </div>
    <p v-if="props.pending" class="mt-1 text-xs text-muted" role="status">Enviando…</p>
    <MessageActions
      v-else
      :text="props.text"
      :timestamp="props.timestamp"
      label="Copiar mensaje"
      align="end"
    />
  </div>
</template>
