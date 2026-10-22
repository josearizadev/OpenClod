import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { TranscriptItem } from '../../../shared/sessions'

/**
 * Lo que los componentes del transcript necesitan de la sesión de chat activa: el
 * transcript en vivo de cada subagente y, más adelante, abrir un archivo en el panel
 * derecho. Fuera de una sesión activa no hay nada y se comportan como en el visor.
 */
export interface ChatContext {
  liveSubagents: ComputedRef<Readonly<Record<string, TranscriptItem[]>>>
  /** La sesión está trabajando (las llamadas sin resultado están en curso). */
  working: ComputedRef<boolean>
  /** Llamadas cuya tarea sigue viva (subagentes y comandos en segundo plano). */
  runningTools: ComputedRef<ReadonlySet<string>>
  /** Abre un archivo en el panel derecho. */
  openFile?: (path: string) => void
  /** Lleva a la llamada de una herramienta (aviso de tarea). */
  jumpToTool?: (toolUseId: string) => void
}

const KEY: InjectionKey<ChatContext> = Symbol('chat-context')

export function provideChatContext(context: ChatContext): void {
  provide(KEY, context)
}

const EMPTY: ChatContext = {
  liveSubagents: computed(() => ({})),
  working: computed(() => false),
  runningTools: computed(() => new Set<string>())
}

export function useChatContext(): ChatContext {
  return inject(KEY, EMPTY)
}
