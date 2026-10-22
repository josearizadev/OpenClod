import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Atajo global de teclado (`'ctrl+p'`). Escucha en `window`, ignora las
 * repeticiones de tecla mantenida y se desregistra al desmontar el componente.
 */
export function useShortcut(combo: string, handler: (event: KeyboardEvent) => void): void {
  const parts = combo.toLowerCase().split('+')
  const key = parts.at(-1) ?? ''
  const ctrl = parts.includes('ctrl')
  const shift = parts.includes('shift')
  const alt = parts.includes('alt')

  const listener = (event: KeyboardEvent): void => {
    if (event.repeat) return
    // Dentro de la terminal las teclas son del shell (`Ctrl+K`, `Ctrl+U`, `Ctrl+P`…).
    if (event.target instanceof Element && event.target.closest('.xterm')) return
    if (event.key.toLowerCase() !== key) return
    if (event.ctrlKey !== ctrl || event.shiftKey !== shift || event.altKey !== alt) return
    event.preventDefault()
    handler(event)
  }

  onMounted(() => window.addEventListener('keydown', listener))
  onBeforeUnmount(() => window.removeEventListener('keydown', listener))
}
