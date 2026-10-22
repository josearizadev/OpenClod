<script setup lang="ts">
import { Compass } from 'lucide-vue-next'

// Saludo según la hora local. Sin nombre de usuario hasta tener ajustes.
const hour = new Date().getHours()
const greeting =
  hour < 6 || hour >= 21 ? 'Buenas noches' : hour < 14 ? 'Buenos días' : 'Buenas tardes'
</script>

<template>
  <div class="flex flex-col items-center gap-2 text-center">
    <h2 class="flex items-center gap-3 font-serif text-[2.125rem] leading-tight">
      <!-- Icono propio de la app (brújula de bitácora), nunca el spark de Anthropic. -->
      <Compass class="shrink-0 text-accent" :size="32" :stroke-width="1.5" aria-hidden="true" />
      {{ greeting }}
    </h2>
    <p class="font-serif text-lg text-muted">¿En qué trabajamos hoy?</p>
  </div>
</template>
