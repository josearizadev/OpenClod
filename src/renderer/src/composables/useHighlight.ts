import { nextTick, onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from 'vue'
import { highlight } from '../lib/highlight'

/**
 * Resalta los `code[data-lang]` de `root` cuando se acercan a la vista. Mientras
 * tanto se ve el texto plano; el resaltado no cambia la altura (mismo texto, mismas líneas), así
 * que no mueve la posición de lectura.
 */
export function useHighlight(
  root: Ref<HTMLElement | null>,
  source: WatchSource,
  /** Mientras devuelva `false` no se resalta (texto en streaming). */
  enabled: () => boolean = () => true
): void {
  let observer: IntersectionObserver | null = null

  async function apply(code: HTMLElement): Promise<void> {
    const text = code.textContent ?? ''
    const html = await highlight(text, code.dataset['lang'])
    // El bloque pudo cambiar o desmontarse mientras cargaba shiki.
    if (html === null || !code.isConnected || code.textContent !== text) return
    code.innerHTML = html
    code.dataset['highlighted'] = 'true'
  }

  function scan(): void {
    observer?.disconnect()
    const el = root.value
    if (!el || !enabled()) return
    const blocks = [...el.querySelectorAll<HTMLElement>('code[data-lang]:not([data-highlighted])')]
    if (blocks.length === 0) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer?.unobserve(entry.target)
          void apply(entry.target as HTMLElement)
        }
      },
      { rootMargin: '400px 0px' }
    )
    for (const block of blocks) observer.observe(block)
  }

  onMounted(scan)
  watch([source, enabled], () => void nextTick(scan))
  onBeforeUnmount(() => observer?.disconnect())
}
