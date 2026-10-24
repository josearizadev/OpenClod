import {
  ATTACHMENTS_MAX,
  IMAGE_MAX_BYTES,
  IMAGE_MEDIA_TYPES,
  type ChatAttachment,
  type ImageMediaType
} from '../../../shared/chat'
import { t } from '../i18n'

/**
 * De archivos soltados, pegados o elegidos a adjuntos del chat. Lo que
 * tiene ruta en disco va por su ruta (el main lo lee y lo valida); una imagen sin archivo, como
 * una captura pegada, va en base64.
 */

export interface AttachResult {
  attachments: ChatAttachment[]
  errors: string[]
}

function isImageType(type: string): type is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(type)
}

function baseName(path: string): string {
  return path.replace(/^.*[\\/]/, '') || path
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error(t('No se pudo leer')))
    reader.readAsDataURL(file)
  })
}

/** Nombre de una imagen pegada sin archivo: «Imagen pegada.png». */
function pastedName(type: ImageMediaType): string {
  return `${t('Imagen pegada')}.${type.slice('image/'.length).replace('jpeg', 'jpg')}`
}

/** `current`: los que ya hay, para no pasar del máximo ni repetir rutas. */
export async function attachFiles(
  files: readonly File[],
  current: readonly ChatAttachment[]
): Promise<AttachResult> {
  const out: AttachResult = { attachments: [], errors: [] }
  const paths = new Set(current.flatMap((a) => (a.kind === 'file' ? [a.path] : [])))
  for (const file of files) {
    if (current.length + out.attachments.length >= ATTACHMENTS_MAX) {
      out.errors.push(t('Como mucho {n} adjuntos por mensaje.', { n: ATTACHMENTS_MAX }))
      break
    }
    const path = window.api.files.pathFor(file)
    if (path) {
      if (!paths.has(path))
        out.attachments.push({ kind: 'file', name: file.name || baseName(path), path })
      paths.add(path)
      continue
    }
    if (!isImageType(file.type)) {
      out.errors.push(
        t('«{name}» no se puede adjuntar: no está guardado en disco.', {
          name: file.name || t('Archivo')
        })
      )
      continue
    }
    if (file.size > IMAGE_MAX_BYTES) {
      out.errors.push(t('«{name}» pesa más de 5 MB.', { name: file.name || t('Imagen') }))
      continue
    }
    try {
      const data = await readBase64(file)
      out.attachments.push({
        kind: 'image',
        name: pastedName(file.type),
        mediaType: file.type,
        data
      })
    } catch {
      out.errors.push(t('No se pudo leer «{name}».', { name: file.name || t('la imagen') }))
    }
  }
  return out
}

/** Rutas del diálogo «Adjuntar archivos». */
export function attachPaths(
  paths: readonly string[],
  current: readonly ChatAttachment[]
): AttachResult {
  const out: AttachResult = { attachments: [], errors: [] }
  const seen = new Set(current.flatMap((a) => (a.kind === 'file' ? [a.path] : [])))
  for (const path of paths) {
    if (seen.has(path)) continue
    if (current.length + out.attachments.length >= ATTACHMENTS_MAX) {
      out.errors.push(t('Como mucho {n} adjuntos por mensaje.', { n: ATTACHMENTS_MAX }))
      break
    }
    seen.add(path)
    out.attachments.push({ kind: 'file', name: baseName(path), path })
  }
  return out
}

/** Miniatura de una imagen pegada (`data:` lo permite la CSP). */
export function thumbnailOf(attachment: ChatAttachment): string | null {
  return attachment.kind === 'image'
    ? `data:${attachment.mediaType};base64,${attachment.data}`
    : null
}

/** Imágenes que verá Claude: pegadas y archivos con extensión de imagen. */
export function imageCount(attachments: readonly ChatAttachment[]): number {
  return attachments.filter((a) => a.kind === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(a.path))
    .length
}
