import { inject, provide, reactive, ref, type InjectionKey, type Ref } from 'vue'

/**
 * Plegado de los bloques del transcript. Cada bloque plegable se
 * identifica por su clave estable (`línea:orden`, o `clave/id` dentro de un grupo), así el estado
 * se conserva al cambiar los filtros. «Desplegar todo» / «Plegar todo» cambian el valor por
 * defecto y olvidan lo hecho a mano.
 */
export interface FoldState {
  /** `true` = todo desplegado por defecto. */
  expandAll: Ref<boolean>
  isOpen(key: string): boolean
  toggle(key: string): void
  set(key: string, open: boolean): void
  setAll(open: boolean): void
}

const FOLD_KEY: InjectionKey<FoldState> = Symbol('fold-state')

function createFoldState(): FoldState {
  const expandAll = ref(false)
  const overrides = reactive(new Map<string, boolean>())
  return {
    expandAll,
    isOpen: (key) => overrides.get(key) ?? expandAll.value,
    toggle(key) {
      overrides.set(key, !(overrides.get(key) ?? expandAll.value))
    },
    set(key, open) {
      overrides.set(key, open)
    },
    setAll(open) {
      expandAll.value = open
      overrides.clear()
    }
  }
}

/** Lo crea la vista del transcript y lo usan todos los bloques plegables que cuelgan de ella. */
export function provideFoldState(state: FoldState = createFoldState()): FoldState {
  provide(FOLD_KEY, state)
  return state
}

/** Fuera de un transcript (p. ej. el chat de prueba) cada componente tiene el suyo. */
export function useFoldState(): FoldState {
  return inject(FOLD_KEY, null) ?? createFoldState()
}
