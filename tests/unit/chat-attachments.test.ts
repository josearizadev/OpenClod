import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AttachmentError,
  buildUserContent,
  sniffImage,
  type UserContent
} from '../../src/main/services/chat/attachments'
import { ChatSession } from '../../src/main/services/chat/chat-session'
import { ChatSendInputSchema, IMAGE_MAX_BYTES } from '../../src/shared/chat'
import { fakeFactory, flush } from './chat-fake-query'

// PNG de 1×1 px real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): { root: string; claudeDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'bitacora-adjuntos-'))
  dirs.push(root)
  const claudeDir = join(root, '.claude')
  mkdirSync(claudeDir)
  return { root, claudeDir }
}

describe('adjuntos del chat', () => {
  it('reconoce las imágenes por su cabecera, no por lo que dicen ser', () => {
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(JPEG)).toBe('image/jpeg')
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImage(Buffer.from('hola'))).toBeNull()
  })

  it('una imagen pegada va como bloque `image` y el texto se recorta', async () => {
    const { claudeDir } = tempDir()
    const content = await buildUserContent(
      '  ¿Qué ves?  ',
      [
        { kind: 'image', name: 'captura.png', mediaType: 'image/png', data: PNG.toString('base64') }
      ],
      { claudeDir }
    )
    expect(content.text).toBe('¿Qué ves?')
    expect(content.images).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') }
      }
    ])
  })

  it('rechaza imágenes con otro tipo real, base64 roto o de más de 5 MB', async () => {
    const { claudeDir } = tempDir()
    const image = (
      data: string,
      mediaType: 'image/png' | 'image/jpeg' = 'image/png'
    ): Promise<UserContent> =>
      buildUserContent('x', [{ kind: 'image', name: 'a.png', mediaType, data }], { claudeDir })
    await expect(image(JPEG.toString('base64'))).rejects.toThrow(AttachmentError)
    await expect(image('no*es*base64')).rejects.toThrow('no tiene datos de imagen válidos')
    const big = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)])
    await expect(image(big.toString('base64'))).rejects.toThrow('más de 5 MB')
  })

  it('un archivo de imagen del disco va como imagen; el resto, como lista de rutas', async () => {
    const { root, claudeDir } = tempDir()
    const png = join(root, 'plano.png')
    const notes = join(root, 'notas.md')
    const pdf = join(root, 'informe.pdf')
    writeFileSync(png, PNG)
    writeFileSync(notes, '# Notas')
    writeFileSync(pdf, '%PDF-1.7')
    const content = await buildUserContent(
      'Revisa esto',
      [
        { kind: 'file', name: 'plano.png', path: png },
        { kind: 'file', name: 'notas.md', path: notes },
        { kind: 'file', name: 'informe.pdf', path: pdf },
        { kind: 'file', name: 'notas.md', path: notes }
      ],
      { claudeDir }
    )
    expect(content.images).toHaveLength(1)
    expect(content.images[0]?.source.media_type).toBe('image/png')
    expect(content.text).toBe(`Revisa esto\n\nArchivos adjuntos:\n- ${notes}\n- ${pdf}`)
  })

  it('solo con archivos, el texto es la lista', async () => {
    const { root, claudeDir } = tempDir()
    const file = join(root, 'datos.csv')
    writeFileSync(file, 'a,b')
    const content = await buildUserContent('', [{ kind: 'file', name: 'datos.csv', path: file }], {
      claudeDir
    })
    expect(content.text).toBe(`Archivos adjuntos:\n- ${file}`)
  })

  it('nunca lee la carpeta de Claude Code ni rutas relativas o que no existen', async () => {
    const { root, claudeDir } = tempDir()
    const secret = join(claudeDir, '.credentials.json')
    writeFileSync(secret, '{}')
    const file = (path: string): Promise<UserContent> =>
      buildUserContent('x', [{ kind: 'file', name: 'f', path }], { claudeDir })
    await expect(file(secret)).rejects.toThrow('carpeta de Claude Code')
    await expect(file('notas.md')).rejects.toThrow('ruta válida')
    await expect(file(join(root, 'no-existe.txt'))).rejects.toThrow('ya no existe')
    await expect(file(root)).rejects.toThrow('no es un archivo')
  })

  it('el contrato acepta un mensaje solo con adjuntos y rechaza uno vacío', () => {
    const sessionId = '87b26aad-df9e-441f-8b3b-5753ccdc17cb'
    const attachment = { kind: 'file', name: 'a.txt', path: 'C:\\a.txt' }
    expect(
      ChatSendInputSchema.safeParse({ sessionId, text: '', attachments: [attachment] }).success
    ).toBe(true)
    expect(ChatSendInputSchema.safeParse({ sessionId, text: '  ' }).success).toBe(false)
    expect(
      ChatSendInputSchema.safeParse({
        sessionId,
        text: 'x',
        attachments: Array.from({ length: 21 }, () => attachment)
      }).success
    ).toBe(false)
  })
})

describe('ChatSession con imágenes', () => {
  it('entrega imágenes y texto como bloques; la cola cuenta las imágenes', async () => {
    const { factory, queries } = fakeFactory()
    const quiet = { info: (): void => {}, warn: (): void => {}, error: (): void => {} }
    const session = new ChatSession(
      { cwd: 'C:\\proyecto' },
      { query: factory, base: {}, emit: () => {}, log: quiet, closeGraceMs: 0 }
    )
    const image = {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AAAA' }
    }
    session.send('¿Qué ves?', undefined, false, [image])
    await flush()
    expect(queries[0]!.received[0]!.message.content).toEqual([
      image,
      { type: 'text', text: '¿Qué ves?' }
    ])
    // Con un turno en curso va a la cola con su número de imágenes.
    session.send('', undefined, false, [image, image])
    // El primero sigue «Enviando…» hasta que Claude lo recibe.
    expect(session.snapshot().queue).toMatchObject([
      { state: 'sending', images: 1 },
      { text: '', state: 'queued', images: 2 }
    ])
  })
})
