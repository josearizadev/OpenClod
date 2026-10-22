<script setup lang="ts">
import { Image, Pencil, SendHorizontal, X } from 'lucide-vue-next'
import type { QueuedMessage } from '../../../../shared/chat'
import IconButton from '../ui/IconButton.vue'

/**
 * Mensajes «En cola» sobre el compositor: editables en el propio
 * compositor, cancelables y con «Enviar ya». Los ya entregados se ven atenuados al final del
 * transcript hasta que Claude los recibe: aquí solo llegan los de `queued`.
 */
defineProps<{
  queue: QueuedMessage[]
  /** El que se está editando en el compositor. */
  editing?: string | null
}>()

const emit = defineEmits<{
  edit: [uuid: string]
  remove: [uuid: string]
  sendNow: [uuid: string]
}>()
</script>

<template>
  <ul v-if="queue.length > 0" class="flex flex-col gap-1" aria-label="Mensajes en cola">
    <li
      v-for="item in queue"
      :key="item.uuid"
      class="flex min-w-0 items-center gap-2 rounded-item bg-surface px-3 py-1 text-sm shadow-float"
      :class="editing === item.uuid ? 'ring-2 ring-accent' : ''"
    >
      <span class="shrink-0 text-xs text-muted">En cola</span>
      <span
        v-if="item.images"
        class="flex shrink-0 items-center gap-1 text-xs text-muted"
        :aria-label="item.images === 1 ? '1 imagen' : `${item.images} imágenes`"
      >
        <Image :size="12" :stroke-width="1.75" aria-hidden="true" />{{ item.images }}
      </span>
      <span class="min-w-0 flex-1 truncate text-text" :title="item.text">{{ item.text }}</span>
      <IconButton :icon="Pencil" label="Editar" @click="emit('edit', item.uuid)" />
      <IconButton :icon="SendHorizontal" label="Enviar ya" @click="emit('sendNow', item.uuid)" />
      <IconButton :icon="X" label="Quitar de la cola" @click="emit('remove', item.uuid)" />
    </li>
  </ul>
</template>
