import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * Copia texto al portapapeles y deja `copied` a `true` durante un momento, para cambiar el
 * icono del botón. Si el portapapeles falla (sin foco, permiso denegado) no hace nada más
 * que registrarlo.
 */
export function useCopy(): { copied: Ref<boolean>; copy: (text: string) => Promise<void> } {
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.error('No se pudo copiar al portapapeles:', error)
      return
    }
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1500)
  }

  onBeforeUnmount(() => clearTimeout(timer))

  return { copied, copy }
}
