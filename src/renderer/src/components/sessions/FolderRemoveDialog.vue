<script setup lang="ts">
import { t } from '../../i18n'
import { computed } from 'vue'
import { useFoldersStore } from '../../stores/folders'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

/** Confirmación de «Eliminar carpeta…»: sus sesiones se quedan, sin carpeta. */
const folders = useFoldersStore()

const open = computed({
  get: () => folders.removing !== null,
  set: (value) => {
    if (!value) folders.removing = null
  }
})

async function confirm(): Promise<void> {
  const folder = folders.removing
  folders.removing = null
  if (folder) await folders.remove(folder.id)
}
</script>

<template>
  <ConfirmDialog
    v-model:open="open"
    :title="t('¿Eliminar la carpeta «{name}»?', { name: folders.removing?.name ?? '' })"
    :description="
      t(
        'Sus sesiones no se eliminan: vuelven a la lista del proyecto. Se pierde el contexto de la carpeta.'
      )
    "
    :confirm-label="t('Eliminar')"
    danger
    @confirm="confirm"
  />
</template>
