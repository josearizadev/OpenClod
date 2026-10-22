<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SystemInfo } from '../../../shared/types'
import ClaudeDataPanel from '../components/diagnostics/ClaudeDataPanel.vue'
import IndexPanel from '../components/diagnostics/IndexPanel.vue'
import UsagePanel from '../components/diagnostics/UsagePanel.vue'
import { useChatStore } from '../stores/chat'

const chat = useChatStore()

const info = ref<SystemInfo | null>(null)
const infoError = ref<string | null>(null)

const pingResult = ref<string | null>(null)
const pingOk = ref(true)
const pinging = ref(false)

onMounted(async () => {
  const infoResult = await window.api.system.info()
  if (infoResult.ok) info.value = infoResult.data
  else infoError.value = infoResult.error.message
})

async function ping(): Promise<void> {
  pinging.value = true
  const started = performance.now()
  const result = await window.api.system.ping('hola')
  const ms = Math.round(performance.now() - started)
  pingOk.value = result.ok
  pingResult.value = result.ok
    ? `Respuesta «${result.data.pong}» en ${ms} ms`
    : `${result.error.code}: ${result.error.message}`
  pinging.value = false
}
</script>

<template>
  <div class="mx-auto flex max-w-chat flex-col gap-8 px-6 py-8">
    <section aria-labelledby="diag-versions">
      <h2 id="diag-versions" class="mb-3 font-serif text-xl">Versiones</h2>
      <p v-if="infoError" class="text-danger">No se pudieron leer: {{ infoError }}</p>
      <dl
        v-else
        class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 shadow-float"
      >
        <dt class="text-muted">OpenClod</dt>
        <dd class="font-mono">{{ info?.app ?? '…' }}</dd>
        <dt class="text-muted">Electron</dt>
        <dd class="font-mono">{{ info?.electron ?? '…' }}</dd>
        <dt class="text-muted">Chrome</dt>
        <dd class="font-mono">{{ info?.chrome ?? '…' }}</dd>
        <dt class="text-muted">Node</dt>
        <dd class="font-mono">{{ info?.node ?? '…' }}</dd>
      </dl>
    </section>

    <section aria-labelledby="diag-data">
      <h2 id="diag-data" class="mb-3 font-serif text-xl">Datos locales</h2>
      <IndexPanel />
      <p class="mt-3 text-sm text-muted">
        Logs:
        <span class="font-mono break-all">{{ info ? (info.logFile ?? 'Solo consola') : '…' }}</span>
      </p>
    </section>

    <ClaudeDataPanel />

    <UsagePanel />

    <section aria-labelledby="diag-chat">
      <h2 id="diag-chat" class="mb-3 font-serif text-xl">Chat</h2>
      <dl
        class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-dialog bg-surface p-4 shadow-float"
      >
        <dt class="text-muted">Sesiones de chat activas</dt>
        <dd class="tabular-nums">{{ chat.activeCount }}</dd>
        <dt class="text-muted">Trabajando o esperando permiso</dt>
        <dd class="tabular-nums">{{ chat.workingCount }}</dd>
        <dt class="text-muted">Modelos y comandos conocidos</dt>
        <dd class="tabular-nums">
          {{ chat.catalog.models.length }} · {{ chat.catalog.commands.length }}
        </dd>
      </dl>
    </section>

    <section aria-labelledby="diag-ipc">
      <h2 id="diag-ipc" class="mb-3 font-serif text-xl">Comunicación con el proceso principal</h2>
      <div class="flex flex-wrap items-center gap-4">
        <button
          type="button"
          :disabled="pinging"
          class="rounded-item bg-accent px-4 py-2 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:opacity-40"
          @click="ping"
        >
          Hacer ping
        </button>
        <p v-if="pingResult" :class="pingOk ? 'text-text' : 'text-danger'" role="status">
          {{ pingResult }}
        </p>
      </div>
    </section>
  </div>
</template>
