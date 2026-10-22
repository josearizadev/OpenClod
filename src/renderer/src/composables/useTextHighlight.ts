import { onBeforeUnmount, watch, type Ref } from 'vue'
import { normalizeWithMap } from '../../../shared/search'

/** Letra o número: lo que no puede ir justo antes de un principio de palabra. */
const WORD = /[\p{L}\p{N}]/u

/**
 * Resaltado de coincidencias sobre los artículos montados del transcript
 * con la CSS Custom Highlight API: no toca el Markdown ni las claves de bloque y funciona con la
 * virtualización. Se recalcula como mucho una vez por marco cuando cambia lo montado. Las
 * coincidencias del bloque `current` van en `find-current`; el resto, en `find-match`.
 */
export function useTextHighlight(
  root: Ref<HTMLElement | null>,
  terms: Ref<readonly string[]>,
  current: Ref<string | null>,
  /** Solo al principio de palabra, como casa FTS5 (búsqueda global); si no, cualquier subcadena. */
  wordStart: Ref<boolean>
): void {
  const supported = typeof CSS !== 'undefined' && 'highlights' in CSS
  let frame = 0
  let observer: MutationObserver | null = null

  function clear(): void {
    if (!supported) return
    CSS.highlights.delete('find-match')
    CSS.highlights.delete('find-current')
  }

  function paint(): void {
    frame = 0
    const el = root.value
    const list = terms.value.filter((t) => t.length > 0)
    if (!supported || !el || list.length === 0) {
      clear()
      return
    }
    const matches: Range[] = []
    const currents: Range[] = []
    for (const article of el.querySelectorAll<HTMLElement>('article[data-key]')) {
      const isCurrent = current.value !== null && article.dataset['key'] === current.value
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue ?? ''
        if (value.length < 1) continue
        const { text, map } = normalizeWithMap(value)
        for (const term of list) {
          for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
            if (wordStart.value && at > 0 && WORD.test(text[at - 1] as string)) continue
            const range = document.createRange()
            range.setStart(node, map[at] as number)
            range.setEnd(node, map[at + term.length] as number)
            ;(isCurrent ? currents : matches).push(range)
          }
        }
      }
    }
    CSS.highlights.set('find-match', new Highlight(...matches))
    CSS.highlights.set('find-current', new Highlight(...currents))
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(paint)
  }

  watch(
    root,
    (el) => {
      observer?.disconnect()
      observer = null
      if (!el || !supported) return
      observer = new MutationObserver(schedule)
      observer.observe(el, { childList: true, subtree: true, characterData: true })
      schedule()
    },
    { immediate: true }
  )
  watch([terms, current, wordStart], schedule)

  onBeforeUnmount(() => {
    observer?.disconnect()
    if (frame) cancelAnimationFrame(frame)
    clear()
  })
}
