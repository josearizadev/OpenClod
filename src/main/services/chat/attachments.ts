import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { IMAGE_MAX_BYTES, type ChatAttachment, type ImageMediaType } from '../../../shared/chat'
import { isInside } from '../paths'
import { t } from '../../i18n'

/**
 * Adjuntos de un mensaje. Las imágenes van a Claude como
 * bloques `image`; los demás archivos, como rutas al final del texto para que Claude Code los lea
 * con sus herramientas. Nada se lee de la carpeta de Claude Code.
 */

export interface ImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: ImageMediaType; data: string }
}

export interface UserContent {
  /** Texto del usuario más la lista «Archivos adjuntos». */
  text: string
  /** Imágenes, en el orden en que se adjuntaron. */
  images: ImageBlock[]
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentError'
  }
}

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Tipo real de la imagen por su cabecera, o `null` si no es ninguno de los admitidos. */
export function sniffImage(bytes: Uint8Array): ImageMediaType | null {
  const at = (i: number, ...values: number[]): boolean => values.every((v, k) => bytes[i + k] === v)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

function imageBlock(bytes: Buffer, name: string, declared?: ImageMediaType): ImageBlock {
  if (bytes.length === 0) throw new AttachmentError(t('«{name}» está vacía.', { name }))
  if (bytes.length > IMAGE_MAX_BYTES)
    throw new AttachmentError(
      t('«{name}» pesa más de 5 MB: no se puede enviar como imagen.', { name })
    )
  const real = sniffImage(bytes)
  if (!real || (declared && real !== declared))
    throw new AttachmentError(
      t('«{name}» no es una imagen PNG, JPEG, GIF o WebP válida.', { name })
    )
  return {
    type: 'image',
    source: { type: 'base64', media_type: real, data: bytes.toString('base64') }
  }
}

function decodeBase64(data: string, name: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0)
    throw new AttachmentError(t('«{name}» no tiene datos de imagen válidos.', { name }))
  return Buffer.from(data, 'base64')
}

/** Ruta real de un archivo adjunto; rechaza lo que no existe o cae en la carpeta de Claude Code. */
async function checkFile(
  path: string,
  name: string,
  claudeDir: string
): Promise<{ real: string; size: number }> {
  if (!isAbsolute(path))
    throw new AttachmentError(t('«{name}» no tiene una ruta válida.', { name }))
  let real: string
  let size: number
  try {
    real = await realpath(path)
    const info = await stat(real)
    if (!info.isFile()) throw new Error('no es un archivo')
    size = info.size
  } catch {
    throw new AttachmentError(t('«{name}» ya no existe o no es un archivo.', { name }))
  }
  const claudeReal = await realpath(claudeDir).catch(() => claudeDir)
  if (isInside(real, claudeReal))
    throw new AttachmentError(t('No se pueden adjuntar archivos de la carpeta de Claude Code.'))
  return { real, size }
}

export async function buildUserContent(
  text: string,
  attachments: readonly ChatAttachment[],
  opts: { claudeDir: string }
): Promise<UserContent> {
  const images: ImageBlock[] = []
  const paths: string[] = []
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      images.push(
        imageBlock(
          decodeBase64(attachment.data, attachment.name),
          attachment.name,
          attachment.mediaType
        )
      )
      continue
    }
    const { real, size } = await checkFile(attachment.path, attachment.name, opts.claudeDir)
    const asImage = IMAGE_EXTENSIONS[extname(real).toLowerCase()]
    // Una imagen del disco que cabe va como imagen; si no, Claude Code la abre por su ruta.
    if (asImage && size <= IMAGE_MAX_BYTES) {
      images.push(imageBlock(await readFile(real), attachment.name))
    } else if (!paths.includes(real)) {
      paths.push(real)
    }
  }
  const list =
    paths.length > 0 ? `${t('Archivos adjuntos:')}\n${paths.map((p) => `- ${p}`).join('\n')}` : ''
  const body = text.trim()
  return { text: [body, list].filter(Boolean).join('\n\n'), images }
}
