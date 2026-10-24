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
import { computed, ref } from 'vue'
import { SOURCE_LABELS, type SlashEntry, type SlashSource } from '../../lib/slash-commands'

/** `/help`: todos los comandos, agrupados por quién los ejecuta. */
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{ commands: SlashEntry[] }>()
const emit = defineEmits<{ pick: [name: string] }>()

const query = ref('')

const GROUPS: { source: SlashSource; hint: string }[] = [
  { source: 'claude', hint: t('Los ejecuta Claude Code en la sesión.') },
  { source: 'app', hint: t('Los resuelve OpenClod con su propia interfaz.') },
  { source: 'terminal', hint: t('Solo funcionan en la terminal: se ofrece abrir la sesión allí.') }
]

const groups = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/^\//, '')
  return GROUPS.map((g) => ({
    ...g,
    items: props.commands
      .filter((c) => c.source === g.source)
      .filter((c) => !q || c.name.includes(q) || c.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  })).filter((g) => g.items.length > 0)
})

function pick(name: string): void {
  open.value = false
  emit('pick', name)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex max-h-[min(36rem,calc(100vh-4rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-dialog bg-surface p-5 text-text shadow-float"
      >
        <div>
          <DialogTitle class="font-serif text-lg">{{ t('Comandos') }}</DialogTitle>
          <DialogDescription class="text-sm text-muted">
            {{ t('Escribe') }} <code class="font-mono">/</code>
            {{ t('en el mensaje para usarlos.') }}
          </DialogDescription>
        </div>
        <input
          v-model="query"
          :aria-label="t('Filtrar comandos')"
          :placeholder="t('Filtrar…')"
          class="h-8 rounded-item border border-border bg-bg px-2 text-sm outline-none placeholder:text-muted focus-visible:border-accent"
        />
        <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <section v-for="g in groups" :key="g.source" class="mb-3">
            <h3 class="text-sm font-medium">{{ SOURCE_LABELS[g.source] }}</h3>
            <p class="mb-1 text-xs text-muted">{{ g.hint }}</p>
            <ul class="flex flex-col">
              <li v-for="c in g.items" :key="c.name">
                <button
                  type="button"
                  class="flex w-full min-w-0 items-baseline gap-2 rounded-item px-2 py-1 text-left text-sm hover:bg-surface-hover"
                  @click="pick(c.name)"
                >
                  <code class="shrink-0 font-mono text-[13px]">/{{ c.name }}</code>
                  <span class="min-w-0 truncate text-xs text-muted">{{ c.description }}</span>
                </button>
              </li>
            </ul>
          </section>
          <p v-if="groups.length === 0" class="text-sm text-muted">
            {{ t('Ningún comando coincide.') }}
          </p>
        </div>
        <div class="flex justify-end">
          <DialogClose class="h-8 rounded-item px-3 text-sm hover:bg-surface-hover">
            {{ t('Cerrar') }}
          </DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
