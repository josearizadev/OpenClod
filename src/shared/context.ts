import { z } from 'zod'

/**
 * Contexto que OpenClod añade al system prompt de Claude Code al empezar una sesión: los `.md`
 * activos del contexto del proyecto (en los datos de la app) y el de la carpeta de sesiones.
 */

/** Máximo de un archivo de contexto del proyecto. */
export const CONTEXT_FILE_MAX = 200 * 1024
/** Máximo del contexto que se envía (se recorta). */
export const CONTEXT_SEND_MAX = 100_000

/** Nombre de archivo: solo `.md`, sin rutas ni caracteres reservados de Windows. */
export const CONTEXT_NAME = /^(?![. ])[^\\/:*?"<>|]{1,96}(?<![. ])\.md$/i

export function isContextName(name: string): boolean {
  // Sin caracteres de control (no caben en el nombre de un archivo de Windows).
  const printable = [...name].every((ch) => ch.charCodeAt(0) >= 32)
  return printable && CONTEXT_NAME.test(name) && name !== '.md'
}

export const ContextNameSchema = z
  .string()
  .max(100)
  .refine(isContextName, { message: 'Nombre no válido: debe terminar en .md, sin rutas' })

export interface ContextFileInfo {
  name: string
  size: number
  mtimeMs: number
  enabled: boolean
}

export interface ContextFolderListing {
  /** Carpeta del contexto del proyecto (para mostrarla). */
  dir: string
  files: ContextFileInfo[]
}

export interface ContextFile {
  name: string
  text: string
  hash: string
}

export type ContextWrite =
  { ok: true; file: ContextFile } | { ok: false; reason: 'conflict'; file: ContextFile | null }

export interface ContextPart {
  kind: 'file' | 'folder'
  name: string
  chars: number
}

export interface ComposedContext {
  /** Texto que se añade al system prompt; vacío si no hay nada. */
  text: string
  parts: ContextPart[]
  /** Caracteres del contexto antes de recortarlo. */
  chars: number
  truncated: boolean
}

/** Estimación grosera de tokens (≈ 4 caracteres por token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

const ProjectIdSchema = z.string().uuid()

export const ContextListInputSchema = z.object({ projectId: ProjectIdSchema }).strict()
export const ContextReadInputSchema = z
  .object({ projectId: ProjectIdSchema, name: ContextNameSchema })
  .strict()
export const ContextWriteInputSchema = z
  .object({
    projectId: ProjectIdSchema,
    name: ContextNameSchema,
    text: z.string().max(CONTEXT_FILE_MAX),
    /** `null`: crear (falla si ya existe). */
    expectedHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
  })
  .strict()
export const ContextRenameInputSchema = z
  .object({ projectId: ProjectIdSchema, from: ContextNameSchema, to: ContextNameSchema })
  .strict()
export const ContextSetEnabledInputSchema = z
  .object({ projectId: ProjectIdSchema, name: ContextNameSchema, enabled: z.boolean() })
  .strict()
export const ContextPreviewInputSchema = z
  .object({ cwd: z.string().min(1).max(1024), folderId: z.string().uuid().optional() })
  .strict()
