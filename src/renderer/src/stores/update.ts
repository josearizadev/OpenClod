import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { UpdateStatus } from '../../../shared/update'
import { useUiStore } from './ui'
import { t } from '../i18n'

/**
 * Actualizaciones de la app. El estado lo empuja el main (`update:status`); al quedar lista una
 * versión nueva se avisa una vez con un toast que permite reiniciar.
 */
export const useUpdateStore = defineStore('update', () => {
  const ui = useUiStore()
  const status = shallowRef<UpdateStatus>({ state: 'disabled' })

  function apply(next: UpdateStatus): void {
    const wasReady = status.value.state === 'ready'
    status.value = next
    if (next.state === 'ready' && !wasReady) {
      ui.toast(t('OpenClod {version} está lista para instalarse.', { version: next.version }), {
        action: { label: t('Reiniciar'), run: install }
      })
    }
  }

  async function init(): Promise<() => void> {
    const off = window.api.update.onStatus(apply)
    const result = await window.api.update.status()
    if (result.ok) apply(result.data)
    return off
  }

  function check(): void {
    void window.api.update.check()
  }

  function install(): void {
    void window.api.update.install()
  }

  return { status, init, check, install }
})
