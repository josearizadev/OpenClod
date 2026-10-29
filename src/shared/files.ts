import { z } from 'zod'

/**
 * Archivos de la carpeta de una sesión o proyecto. El renderer nunca manda
 * una carpeta raíz: manda un **destino** y el main resuelve la raíz permitida.
 */
export const FileTargetSchema = z.union([
  z.object({ sessionId: z.string().min(1).max(100) }).strict(),
  z.object({ projectId: z.string().uuid() }).strict()
])
export type FileTarget = z.infer<typeof FileTargetSchema>

/** Absoluta o relativa a la raíz del destino. */
const FilePathSchema = z.string().min(1).max(1024)

export const FileRefInputSchema = z
  .object({ target: FileTargetSchema, path: FilePathSchema })
  .strict()

export const FileOpenInputSchema = FileRefInputSchema.extend({
  how: z.enum(['editor', 'folder'])
}).strict()

const UNSAFE_EXTENSIONS = new Set(
  (
    'exe com bat cmd ps1 psm1 psd1 vbs vbe jse wsf wsh msi msp scr lnk url hta cpl ' +
    'jar reg pif scf appref-ms application sh command app desktop'
  ).split(' ')
)

/**
 * Abrirlo con la aplicación predeterminada podría ejecutarlo: solo se ofrece «Mostrar en
 * la carpeta». En Windows, `.js` lo ejecuta Windows Script Host.
 */
export function unsafeToOpen(path: string, windows: boolean): boolean {
  const name = path.replace(/^.*[\\/]/, '')
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return UNSAFE_EXTENSIONS.has(ext) || (windows && ext === 'js')
}

/** Tamaños máximos de la vista previa. */
export const TEXT_PREVIEW_MAX = 1024 * 1024
export const IMAGE_PREVIEW_MAX = 10 * 1024 * 1024

/** `path` es la ruta mostrada: relativa a la raíz si está dentro, con `/`. */
export type FilePreview =
  | {
      kind: 'text' | 'markdown'
      path: string
      text: string
      /** Lenguaje para el resaltado (`text` = sin resaltar). */
      lang: string
      size: number
      /** Solo se muestra el primer MB. */
      truncated: boolean
      mtimeMs: number
    }
  | { kind: 'image'; path: string; dataUrl: string; size: number; mtimeMs: number }
  | { kind: 'binary' | 'too-large'; path: string; size: number }
  | { kind: 'missing' | 'secret' | 'outside'; path: string }

/** Diff contra `HEAD`: `null` = el archivo no existe en ese lado. */
export type FileDiff =
  | { kind: 'text'; path: string; before: string | null; after: string | null }
  | {
      kind: 'binary' | 'too-large' | 'secret' | 'outside' | 'not-repo' | 'unchanged'
      path: string
    }

export interface ClaudeMdFile {
  /** Ruta absoluta del archivo (exista o no). */
  path: string
  exists: boolean
  text: string
  /** SHA-256 del contenido en disco; `null` si no existe. */
  hash: string | null
  mtimeMs: number | null
}

export type ClaudeMdWrite =
  { ok: true; file: ClaudeMdFile } | { ok: false; reason: 'conflict'; file: ClaudeMdFile }

export const CLAUDE_MD_MAX = 1024 * 1024

export const ClaudeMdWriteInputSchema = z
  .object({
    projectId: z.string().uuid(),
    text: z.string().max(CLAUDE_MD_MAX),
    expectedHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
  })
  .strict()

export const SessionExportInputSchema = z
  .object({ sessionId: z.string().min(1).max(100), tools: z.boolean() })
  .strict()

/** Carpeta donde buscar menciones `@`: la de un destino o, en la bienvenida, la elegida. */
export const MentionTargetSchema = z.union([
  FileTargetSchema,
  z.object({ cwd: z.string().min(1).max(1024) }).strict()
])
export type MentionTarget = z.infer<typeof MentionTargetSchema>

export const MentionsInputSchema = z
  .object({ target: MentionTargetSchema, query: z.string().max(512) })
  .strict()

/** Sugerencia de `@`: ruta relativa a la carpeta de trabajo, con `/`. */
export interface MentionEntry {
  path: string
  dir: boolean
}

export const MENTIONS_MAX = 8
