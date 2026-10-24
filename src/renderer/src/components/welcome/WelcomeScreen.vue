<script setup lang="ts">
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  LogIn,
  RefreshCw,
  SquareTerminal
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Locale } from '../../../../shared/i18n'
import { locale, t } from '../../i18n'
import { useAuthStore } from '../../stores/auth'
import { useTerminalStore } from '../../stores/terminal'
import { useUiStore } from '../../stores/ui'
import TerminalPane from '../terminal/TerminalPane.vue'
import appIcon from '../../../../../resources/icon.png'

/**
 * Primera vez que se abre la app: idioma y sesión de Claude Code. Sin sesión, «Iniciar sesión»
 * ejecuta `claude auth login` en una terminal aquí mismo y se comprueba sola cada pocos segundos
 * hasta que la sesión aparece.
 */
const ui = useUiStore()
const auth = useAuthStore()
const terminals = useTerminalStore()

const LANGUAGES: { value: Locale; label: string; hint: string }[] = [
  { value: 'es', label: 'Español', hint: 'Interfaz en español' },
  { value: 'en', label: 'English', hint: 'Interface in English' }
]

function chooseLanguage(value: Locale): void {
  if (value !== locale) void ui.setLanguage(value)
}

/** Terminal con `claude auth login`, si se abrió. */
const loginId = ref<string | null>(null)
const loginInfo = computed(() => terminals.terminals.find((x) => x.id === loginId.value) ?? null)
/** No hay terminal integrada: se explica cómo hacerlo a mano. */
const manual = ref(false)

const POLL_MS = 2500
let poll: ReturnType<typeof setInterval> | null = null

function stopPolling(): void {
  if (poll) clearInterval(poll)
  poll = null
}

async function closeLogin(): Promise<void> {
  stopPolling()
  const id = loginId.value
  loginId.value = null
  if (id) await terminals.close(id)
}

async function startLogin(): Promise<void> {
  manual.value = false
  const opened = await terminals.open('login')
  if (!opened) {
    manual.value = true
    return
  }
  loginId.value = opened.id
  stopPolling()
  poll = setInterval(() => void check(), POLL_MS)
}

async function check(): Promise<void> {
  const status = await auth.refresh()
  if (status.state === 'in' && loginId.value) await closeLogin()
}

// Al cerrarse `claude auth login` (terminó o se canceló), se vuelve a comprobar.
watch(
  () => loginInfo.value?.status,
  (status) => {
    if (status === 'exited') void check().then(() => closeLogin())
  }
)

onMounted(() => void auth.refresh())
onBeforeUnmount(() => void closeLogin())

const state = computed(() => auth.status?.state ?? null)
const account = computed(() => {
  const s = auth.status
  if (!s || s.state !== 'in') return ''
  const plan = s.plan
    ? t('Plan {plan}', { plan: s.plan.charAt(0).toUpperCase() + s.plan.slice(1) })
    : ''
  return [s.email, plan].filter(Boolean).join(' · ')
})

async function finish(): Promise<void> {
  await closeLogin()
  await ui.finishWelcome()
}

const button =
  'inline-flex h-9 items-center gap-2 rounded-item px-4 text-sm transition-colors duration-150'
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto bg-bg text-text">
    <!-- Franja superior: arrastra la ventana y deja sitio a los botones nativos. -->
    <div class="drag-region h-12 shrink-0" />
    <main
      class="mx-auto flex w-full max-w-[36rem] flex-1 flex-col justify-center gap-8 px-6 pb-16"
      aria-labelledby="welcome-title"
    >
      <header class="flex flex-col items-center gap-3 text-center">
        <img :src="appIcon" alt="" class="size-16" />
        <h1 id="welcome-title" class="font-serif text-[2.125rem] leading-tight">
          {{ t('Te damos la bienvenida a OpenClod') }}
        </h1>
        <p class="text-muted">
          {{ t('Claude Code en una ventana propia. Dos cosas antes de empezar.') }}
        </p>
      </header>

      <section aria-labelledby="welcome-language" class="flex flex-col gap-2">
        <h2 id="welcome-language" class="text-sm font-medium">
          {{ t('Idioma') }} <span class="font-normal text-muted">· Language</span>
        </h2>
        <div role="radiogroup" aria-labelledby="welcome-language" class="grid grid-cols-2 gap-2">
          <button
            v-for="option in LANGUAGES"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="option.value === locale"
            :lang="option.value"
            :class="[
              'flex flex-col items-start rounded-item border px-4 py-3 text-left transition-colors duration-150',
              option.value === locale
                ? 'border-accent bg-surface shadow-float'
                : 'border-border hover:bg-surface-hover'
            ]"
            @click="chooseLanguage(option.value)"
          >
            <span class="font-medium">{{ option.label }}</span>
            <span class="text-xs text-muted">{{ option.hint }}</span>
          </button>
        </div>
      </section>

      <section aria-labelledby="welcome-account" class="flex flex-col gap-2">
        <h2 id="welcome-account" class="text-sm font-medium">{{ t('Cuenta de Claude Code') }}</h2>
        <div
          class="flex flex-col gap-3 rounded-item border border-border bg-surface p-4"
          aria-live="polite"
        >
          <!-- Comprobando. -->
          <p v-if="state === null" class="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle
              :size="16"
              :stroke-width="1.75"
              class="shrink-0 motion-safe:animate-spin"
              aria-hidden="true"
            />
            {{ t('Comprobando la sesión de Claude Code…') }}
          </p>

          <!-- Con sesión. -->
          <div v-else-if="state === 'in'" class="flex items-start gap-3">
            <CircleCheck
              :size="18"
              :stroke-width="1.75"
              class="mt-0.5 shrink-0 text-accent"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ t('Sesión iniciada') }}</p>
              <p v-if="account" class="truncate text-sm text-muted">{{ account }}</p>
            </div>
          </div>

          <!-- Sin sesión o sin poder comprobarla. -->
          <template v-else>
            <div class="flex items-start gap-3">
              <CircleAlert
                :size="18"
                :stroke-width="1.75"
                :class="['mt-0.5 shrink-0', state === 'unknown' ? 'text-warning' : 'text-muted']"
                aria-hidden="true"
              />
              <div class="min-w-0 text-sm">
                <p class="font-medium">
                  {{
                    state === 'unknown'
                      ? t('No se pudo comprobar la sesión de Claude Code.')
                      : t('Claude Code no tiene una sesión iniciada en este equipo.')
                  }}
                </p>
                <p class="mt-1 text-muted">
                  {{
                    t(
                      'OpenClod usa la sesión de Claude Code: tu plan de Claude (Pro, Max…) o tu cuenta de la consola de Anthropic. La app nunca ve tu contraseña ni tus claves.'
                    )
                  }}
                </p>
              </div>
            </div>

            <div v-if="loginInfo" class="flex flex-col gap-2">
              <p class="text-xs text-muted">
                {{
                  t(
                    'Sigue los pasos en el navegador. Si no se abre, pulsa el enlace de la terminal; si te piden un código, pégalo en ella.'
                  )
                }}
              </p>
              <div class="h-56 overflow-hidden rounded-item bg-code-bg">
                <TerminalPane :info="loginInfo" active />
              </div>
              <p class="flex items-center gap-2 text-xs text-muted">
                <LoaderCircle
                  :size="13"
                  :stroke-width="1.75"
                  class="shrink-0 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                {{ t('Esperando a que se inicie la sesión…') }}
              </p>
            </div>

            <p v-else-if="manual" class="text-sm">
              {{ t('La terminal integrada no está disponible. Abre una terminal y ejecuta') }}
              <code class="rounded bg-code-bg px-1 font-mono text-[13px]">claude auth login</code
              >{{ t('; después, pulsa «Comprobar de nuevo».') }}
            </p>

            <div class="flex flex-wrap items-center gap-2">
              <button
                v-if="!loginInfo"
                type="button"
                :class="[button, 'bg-accent text-on-accent hover:bg-accent-hover']"
                @click="startLogin"
              >
                <LogIn :size="16" :stroke-width="1.75" aria-hidden="true" />
                {{ t('Iniciar sesión') }}
              </button>
              <button
                v-else
                type="button"
                :class="[button, 'border border-border hover:bg-surface-hover']"
                @click="closeLogin"
              >
                <SquareTerminal :size="16" :stroke-width="1.75" aria-hidden="true" />
                {{ t('Cerrar la terminal') }}
              </button>
              <button
                type="button"
                :class="[button, 'hover:bg-surface-hover disabled:opacity-50']"
                :disabled="auth.checking"
                @click="check"
              >
                <RefreshCw
                  :size="16"
                  :stroke-width="1.75"
                  :class="auth.checking ? 'motion-safe:animate-spin' : ''"
                  aria-hidden="true"
                />
                {{ t('Comprobar de nuevo') }}
              </button>
            </div>
          </template>
        </div>
      </section>

      <footer class="flex items-center justify-end gap-2">
        <button
          v-if="state !== 'in'"
          type="button"
          :class="[button, 'text-muted hover:bg-surface-hover hover:text-text']"
          @click="finish"
        >
          {{ t('Ahora no') }}
        </button>
        <button
          v-else
          type="button"
          :class="[button, 'bg-accent text-on-accent hover:bg-accent-hover']"
          @click="finish"
        >
          {{ t('Empezar') }}
        </button>
      </footer>
    </main>
  </div>
</template>
