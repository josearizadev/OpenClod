<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessionsStore } from '../../stores/sessions'
import { useUiStore } from '../../stores/ui'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

/**
 * Confirmación de «Eliminar…»: una sola para la lista, la barra de
 * selección y el menú de la cabecera. Al terminar avisa de cuántas se movieron y cuántas no.
 */
const sessions = useSessionsStore()
const ui = useUiStore()

// Copia propia: el diálogo se cierra (y vacía `trashRequest`) antes de emitir `confirm`.
const ids = ref<string[]>([])
watch(
  () => sessions.trashRequest,
  (request) => {
    if (request) ids.value = [...request]
  }
)

const open = computed({
  get: () => sessions.trashRequest !== null,
  set: (value: boolean) => {
    if (!value) sessions.trashRequest = null
  }
})
const count = computed(() => ids.value.length)
const title = computed(() =>
  count.value === 1
    ? '¿Mover la conversación a la papelera?'
    : `¿Mover ${count.value} conversaciones a la papelera?`
)

function conversations(n: number): string {
  return n === 1 ? '1 conversación' : `${n} conversaciones`
}

async function confirm(): Promise<void> {
  const request = ids.value
  sessions.trashRequest = null
  if (request.length === 0) return
  const result = await sessions.trash(request)
  if (!result) return ui.toast('No se pudo mover a la papelera', { tone: 'danger' })
  const moved = result.trashed.length
  const active = result.skipped.filter((s) => s.reason === 'active').length
  const failed = result.skipped.length - active
  const parts: string[] = []
  if (moved > 0) parts.push(`${conversations(moved)} a la papelera`)
  if (active > 0) parts.push(`${active} con Claude trabajando, sin tocar`)
  if (failed > 0) parts.push(`${failed} no se pudieron mover`)
  ui.toast(parts.join(' · '), moved === 0 ? { tone: 'danger' } : {})
}
</script>

<template>
  <ConfirmDialog
    v-model:open="open"
    :title="title"
    description="Se quitan de OpenClod y Claude Code ya no podrá retomarlas. Puedes recuperarlas desde la papelera del sistema."
    confirm-label="Mover a la papelera"
    danger
    @confirm="confirm"
  />
</template>
