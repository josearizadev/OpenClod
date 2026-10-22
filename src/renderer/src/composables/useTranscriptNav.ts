import type { Ref } from 'vue'
import { useShortcut } from './useShortcut'

interface Navigable {
  jumpPrompt(direction: -1 | 1): void
  focus(): void
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/**
 * `Alt+↑` / `Alt+↓`: prompt anterior / siguiente del transcript abierto.
 * `Inicio`, `Fin`, `RePág` y `AvPág` los atiende la propia lista cuando tiene el foco.
 */
export function useTranscriptNav(list: Ref<Navigable | null>): void {
  for (const [combo, direction] of [
    ['alt+arrowup', -1],
    ['alt+arrowdown', 1]
  ] as const) {
    useShortcut(combo, (event) => {
      if (isEditable(event.target)) return
      list.value?.jumpPrompt(direction)
      // El foco pasa a la lista: así `RePág`/`AvPág` siguen desde ahí.
      list.value?.focus()
    })
  }
}
