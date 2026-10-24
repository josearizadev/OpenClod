<script setup lang="ts">
import { t } from '../../i18n'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TERMINAL_WRITE_MAX, type TerminalInfo } from '../../../../shared/terminal'
import { useTerminalStore } from '../../stores/terminal'
import { useUiStore } from '../../stores/ui'

/**
 * Una terminal con xterm.js. Al montar pide al main la
 * salida guardada (`attach`) y después recibe la nueva; los colores salen de los tokens.
 */
const props = defineProps<{ info: TerminalInfo; active: boolean }>()

const ui = useUiStore()
const store = useTerminalStore()
const host = ref<HTMLElement | null>(null)

let term: Terminal | null = null
let fit: FitAddon | null = null
let observer: ResizeObserver | null = null
let frame = 0
let stopListening: (() => void) | null = null
let disposed = false

function themeFromTokens(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  return {
    background: v('--code-bg'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--code-bg'),
    selectionBackground: v('--term-selection'),
    black: v('--term-black'),
    red: v('--term-red'),
    green: v('--term-green'),
    yellow: v('--term-yellow'),
    blue: v('--term-blue'),
    magenta: v('--term-magenta'),
    cyan: v('--term-cyan'),
    white: v('--term-white'),
    brightBlack: v('--term-bright-black'),
    brightRed: v('--term-bright-red'),
    brightGreen: v('--term-bright-green'),
    brightYellow: v('--term-bright-yellow'),
    brightBlue: v('--term-bright-blue'),
    brightMagenta: v('--term-bright-magenta'),
    brightCyan: v('--term-bright-cyan'),
    brightWhite: v('--term-bright-white')
  }
}

/** Ajusta columnas y filas al panel (como mucho una vez por marco) y se lo dice al main. */
function refit(): void {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (!term || !fit || !host.value || host.value.clientWidth === 0) return
    const before = [term.cols, term.rows]
    fit.fit()
    if (term.cols !== before[0] || term.rows !== before[1]) {
      void window.api.terminal.resize(props.info.id, term.cols, term.rows)
    }
  })
}

function send(data: string): void {
  for (let i = 0; i < data.length; i += TERMINAL_WRITE_MAX / 4) {
    void window.api.terminal.write(props.info.id, data.slice(i, i + TERMINAL_WRITE_MAX / 4))
  }
}

async function copySelection(): Promise<void> {
  const text = term?.getSelection()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    console.error('No se pudo copiar:', error)
  }
}

onMounted(async () => {
  if (!host.value) return
  term = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
    fontSize: ui.terminal.fontSize,
    cursorBlink: true,
    scrollback: 5000,
    screenReaderMode: ui.terminal.screenReader,
    theme: themeFromTokens(),
    allowProposedApi: false
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  // Los enlaces se abren con `window.open`: el main solo deja pasar http(s) al navegador.
  term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const key = event.key.toLowerCase()
    if (event.ctrlKey && key === 'c' && (event.shiftKey || term?.hasSelection())) {
      void copySelection()
      return false
    }
    // Pegar: lo hace el evento `paste` nativo que xterm.js ya escucha.
    if (event.ctrlKey && key === 'v') return false
    return true
  })
  term.open(host.value)
  term.onData(send)

  const attached = await window.api.terminal.attach(props.info.id)
  if (disposed) return
  if (attached.ok && attached.data.buffer) term.write(attached.data.buffer)
  stopListening = store.listen(props.info.id, (data) => term?.write(data))

  observer = new ResizeObserver(refit)
  observer.observe(host.value)
  refit()
  if (props.active) term.focus()
})

watch(
  () => props.active,
  (active) => {
    if (!active) return
    refit()
    requestAnimationFrame(() => term?.focus())
  }
)
watch(
  () => ui.isDark,
  () => requestAnimationFrame(() => term && (term.options.theme = themeFromTokens()))
)
watch(
  () => [ui.terminal.fontSize, ui.terminal.screenReader] as const,
  ([fontSize, screenReader]) => {
    if (!term) return
    term.options.fontSize = fontSize
    term.options.screenReaderMode = screenReader
    refit()
  }
)

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(frame)
  observer?.disconnect()
  stopListening?.()
  term?.dispose()
  term = null
})
</script>

<template>
  <div
    ref="host"
    class="terminal-host h-full w-full overflow-hidden"
    :aria-label="t('Terminal: {title}', { title: info.title })"
  />
</template>

<style scoped>
.terminal-host :deep(.xterm) {
  height: 100%;
  padding: 8px;
}
.terminal-host :deep(.xterm-viewport) {
  background-color: var(--code-bg) !important;
}
</style>
