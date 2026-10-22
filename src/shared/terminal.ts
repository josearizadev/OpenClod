import { z } from 'zod'
import { FileTargetSchema } from './files'

/**
 * Terminal de respaldo. El renderer pide un **tipo** y un destino; qué shell,
 * qué carpeta y qué orden se ejecutan lo decide el main.
 */
export const TerminalKindSchema = z.enum(['shell', 'claude', 'resume'])
export type TerminalKind = z.infer<typeof TerminalKindSchema>

export const TerminalIdSchema = z.string().uuid()

export const TerminalOpenInputSchema = z
  .object({
    kind: TerminalKindSchema,
    target: FileTargetSchema.optional(),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300)
  })
  .strict()
  .refine((input) => input.kind !== 'resume' || (input.target && 'sessionId' in input.target), {
    message: 'Continuar una sesión necesita su id'
  })
export type TerminalOpenInput = z.infer<typeof TerminalOpenInputSchema>

/** Entrada de teclado o pegado: como mucho 64 kB por mensaje. */
export const TERMINAL_WRITE_MAX = 64 * 1024

export interface TerminalInfo {
  id: string
  kind: TerminalKind
  title: string
  cwd: string
  /** Nombre del shell («PowerShell 7»). */
  shell: string
  sessionId?: string
  status: 'running' | 'exited'
  exitCode?: number
  startedAt: number
}

export interface ShellOption {
  id: string
  label: string
  path: string
}

export interface TerminalShells {
  available: ShellOption[]
  /** `id` del que se usa si no hay ninguno elegido en Ajustes. */
  default: string | null
  /** El módulo nativo no cargó: la terminal no está disponible. */
  error?: string
}
