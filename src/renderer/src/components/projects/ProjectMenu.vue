<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { ScrollText, Settings2, SlidersHorizontal } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '../../stores/projects'

/** Botón junto al selector de proyecto: abre sus instrucciones y sus ajustes. */
const projects = useProjectsStore()
const router = useRouter()

function go(section: 'instrucciones' | 'ajustes'): void {
  if (projects.activeId) void router.push(`/proyecto/${projects.activeId}/${section}`)
}

const itemClass =
  'flex h-8 cursor-default items-center gap-2 rounded-item px-2 outline-none select-none data-[highlighted]:bg-surface-hover'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      aria-label="Configuración del proyecto"
      title="Configuración del proyecto"
      class="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-item text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text data-[state=open]:bg-surface-hover data-[state=open]:text-text"
    >
      <Settings2 :size="18" :stroke-width="1.75" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        side="bottom"
        :side-offset="4"
        :collision-padding="8"
        class="z-30 min-w-56 rounded-menu bg-surface p-1 text-text shadow-float"
      >
        <DropdownMenuItem :class="itemClass" @select="go('instrucciones')">
          <ScrollText :size="16" :stroke-width="1.75" class="shrink-0" />
          <span class="flex-1">Instrucciones</span>
          <span class="pl-4 text-xs text-muted">CLAUDE.md</span>
        </DropdownMenuItem>
        <DropdownMenuItem :class="itemClass" @select="go('ajustes')">
          <SlidersHorizontal :size="16" :stroke-width="1.75" class="shrink-0" />
          <span class="flex-1">Ajustes del proyecto</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
