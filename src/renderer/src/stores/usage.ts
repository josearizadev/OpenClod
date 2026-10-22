import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { Settings } from '../../../shared/types'
import {
  EMPTY_LIMITS,
  type LimitsSnapshot,
  type UsagePeriod,
  type UsageReport,
  type UsageScope
} from '../../../shared/usage'
import { useProjectsStore } from './projects'

type UsageSettings = Settings['usage']

/**
 * Uso y límites. Los límites los empuja el main (`usage:limits`); el
 * informe se pide al abrir la vista, al cambiar selectores o proyecto y tras `index:updated`
 * (como mucho cada 2 s y solo con la vista abierta).
 */
export const useUsageStore = defineStore('usage', () => {
  const projects = useProjectsStore()

  const limits = shallowRef<LimitsSnapshot>(EMPTY_LIMITS)
  const report = shallowRef<UsageReport | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const settings = ref<UsageSettings>({ period: '7d', scope: 'all', showCost: false, probe: true })
  /** Vistas montadas que necesitan el informe. */
  const viewers = ref(0)

  /** Sin proyecto activo, «Este proyecto» se trata como «Todos». */
  const scope = computed<UsageScope>(() =>
    settings.value.scope === 'project' && projects.activeId ? 'project' : 'all'
  )

  let ticket = 0
  let lastLoad = 0
  let pending: ReturnType<typeof setTimeout> | null = null

  async function init(): Promise<() => void> {
    const [s, l] = await Promise.all([window.api.settings.get(), window.api.usage.limits()])
    if (s.ok) settings.value = { ...s.data.usage }
    if (l.ok) limits.value = l.data
    return window.api.usage.onLimits((snapshot) => (limits.value = snapshot))
  }

  async function load(): Promise<void> {
    const mine = ++ticket
    lastLoad = Date.now()
    loading.value = report.value === null
    const result = await window.api.usage.report({
      period: settings.value.period,
      scope: scope.value,
      projectId: scope.value === 'project' ? projects.activeId : null
    })
    if (mine !== ticket) return
    loading.value = false
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    error.value = null
    report.value = result.data
    performance.mark('bitacora:uso-pintado')
  }

  /** Tras `index:updated`: recarga con la vista abierta, como mucho cada 2 s. */
  function onIndexUpdated(changed: boolean): void {
    if (!changed || viewers.value === 0 || pending) return
    const wait = Math.max(0, lastLoad + 2000 - Date.now())
    pending = setTimeout(() => {
      pending = null
      void load()
    }, wait)
  }

  async function update(patch: Partial<UsageSettings>): Promise<void> {
    settings.value = { ...settings.value, ...patch }
    const result = await window.api.settings.set({ usage: settings.value })
    if (result.ok) settings.value = { ...result.data.usage }
  }

  function setPeriod(period: UsagePeriod): void {
    void update({ period })
  }

  function setScope(next: UsageScope): void {
    void update({ scope: next })
  }

  async function probe(force = false): Promise<void> {
    const result = await window.api.usage.probe(force)
    if (result.ok) limits.value = result.data
  }

  watch(
    () => [settings.value.period, settings.value.showCost, scope.value, projects.activeId],
    () => {
      if (viewers.value > 0) void load()
    }
  )

  return {
    limits,
    report,
    loading,
    error,
    settings,
    scope,
    viewers,
    init,
    load,
    onIndexUpdated,
    update,
    setPeriod,
    setScope,
    probe
  }
})
