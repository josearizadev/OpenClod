<script setup lang="ts">
import { t } from '../../i18n'
import { Folder, X } from 'lucide-vue-next'
import type { SessionFolder } from '../../../../shared/types'
import SessionLook from './SessionLook.vue'

/** Bienvenida: la sesión nueva nacerá en esta carpeta; ✕ la quita antes de enviar. */
defineProps<{ folder: SessionFolder; readonly?: boolean }>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div class="inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm text-muted">
    <SessionLook
      v-if="folder.icon || folder.color"
      :icon="folder.icon"
      :color="folder.color"
      :size="16"
    />
    <Folder v-else :size="16" :stroke-width="1.75" aria-hidden="true" />
    <span class="truncate">{{ t('En la carpeta «{name}»', { name: folder.name }) }}</span>
    <button
      v-if="!readonly"
      type="button"
      :aria-label="t('No crear en la carpeta')"
      :title="t('No crear en la carpeta')"
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-item transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      @click="emit('clear')"
    >
      <X :size="14" :stroke-width="1.75" />
    </button>
  </div>
</template>
