<script setup lang="ts">
import type { SnippetPart } from '../../../../shared/search'

/** Fragmento con las coincidencias resaltadas: solo interpolación, nunca HTML. */
defineProps<{ parts: SnippetPart[] }>()
</script>

<template>
  <span
    ><template v-for="(part, index) in parts" :key="index"
      ><mark v-if="part.match" class="rounded-[2px] bg-find-match text-text">{{ part.text }}</mark
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>
