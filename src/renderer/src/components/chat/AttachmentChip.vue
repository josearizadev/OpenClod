<script setup lang="ts">
import { t } from '../../i18n'
import { FileText, X } from 'lucide-vue-next'
import { computed } from 'vue'
import type { ChatAttachment } from '../../../../shared/chat'
import { thumbnailOf } from '../../lib/attachments'

/**
 * Ficha de un adjunto en el compositor: miniatura si es una imagen
 * pegada, icono y nombre si es un archivo; ✕ para quitarlo, visible al pasar o con foco.
 */
const props = defineProps<{ attachment: ChatAttachment }>()
const emit = defineEmits<{ remove: [] }>()

const thumbnail = computed(() => thumbnailOf(props.attachment))
const hint = computed(() =>
  props.attachment.kind === 'file' ? props.attachment.path : props.attachment.name
)
</script>

<template>
  <li
    class="group relative flex h-14 max-w-56 min-w-0 items-center gap-2 rounded-item bg-surface-hover pr-7 pl-2"
    :title="hint"
  >
    <img
      v-if="thumbnail"
      :src="thumbnail"
      alt=""
      class="size-10 shrink-0 rounded-[6px] border border-border object-cover"
    />
    <span
      v-else
      class="inline-flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-surface text-muted"
      aria-hidden="true"
    >
      <FileText :size="18" :stroke-width="1.75" />
    </span>
    <span class="min-w-0 truncate text-sm">{{ attachment.name }}</span>
    <button
      type="button"
      :aria-label="t('Quitar «{name}»', { name: attachment.name })"
      class="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full text-muted opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface hover:text-text focus-visible:opacity-100"
      @click="emit('remove')"
    >
      <X :size="12" :stroke-width="2" />
    </button>
  </li>
</template>
