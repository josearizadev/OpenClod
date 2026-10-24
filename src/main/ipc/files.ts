import { app, BrowserWindow, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FileTarget } from '../../shared/files'
import { ClaudeMdError, readClaudeMd, writeClaudeMd } from '../services/claude-md'
import {
  FileAccessError,
  isUnsafeToOpen,
  resolveInside,
  resolveRoot,
  type RootDeps
} from '../services/file-access'
import { readDiff, readPreview } from '../services/file-preview'
import type { GitService } from '../services/git'
import { logger } from '../services/logger'
import { pathKey } from '../services/paths'
import type { ProjectsService } from '../services/projects'
import { exportFileName, toMarkdown } from '../services/session-export'
import type { TranscriptService } from '../services/transcript'
import { handle, IpcError } from './handle'
import { t } from '../i18n'

export interface FilesIpcDeps extends RootDeps {
  git: GitService
  projects: ProjectsService
  transcripts: TranscriptService
}

/** Traduce los rechazos previstos a errores IPC con su mensaje. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof FileAccessError) throw new IpcError(error.code, error.message)
    if (error instanceof ClaudeMdError) throw new IpcError('INVALID_ARGS', error.message)
    throw error
  }
}

/**
 * Canales de Git, archivos, `CLAUDE.md` y exportación. Toda ruta se resuelve
 * aquí contra la raíz del destino; el renderer nunca manda una carpeta raíz.
 */
export function registerFilesIpc(deps: FilesIpcDeps): void {
  /** Raíz del destino y la de su repositorio Git (si la hay). */
  async function rootsOf(target: FileTarget): Promise<string[]> {
    const root = await resolveRoot(target, deps)
    const top = await deps.git.toplevel(root)
    return top && pathKey(top) !== pathKey(root) ? [root, top] : [root]
  }

  handle('git:info', ({ target, fresh }) =>
    guarded(async () => {
      const root = await resolveRoot(target, deps)
      return deps.git.info(root, { fresh })
    })
  )

  handle('files:read', ({ target, path }) =>
    guarded(async () => {
      const roots = await rootsOf(target)
      const resolved = await resolveInside(path, roots, deps.claudeDir())
      if (!resolved.ok) return { kind: 'outside' as const, path: resolved.display }
      return readPreview(resolved.abs, resolved.display)
    })
  )

  handle('files:diff', ({ target, path }) =>
    guarded(async () => {
      const roots = await rootsOf(target)
      const resolved = await resolveInside(path, roots, deps.claudeDir())
      if (!resolved.ok) return { kind: 'outside' as const, path: resolved.display }
      return readDiff(resolved.abs, resolved.display, deps.git, roots[0]!)
    })
  )

  handle('files:open', ({ target, path, how }) =>
    guarded(async () => {
      const roots = await rootsOf(target)
      const resolved = await resolveInside(path, roots, deps.claudeDir())
      if (!resolved.ok) throw new IpcError('FORBIDDEN', t('El archivo está fuera de la carpeta'))
      if (how === 'folder') {
        if (resolved.exists) shell.showItemInFolder(resolved.abs)
        else await shell.openPath(dirname(resolved.abs))
        return
      }
      if (!resolved.exists) throw new IpcError('NOT_FOUND', t('El archivo ya no existe'))
      if (isUnsafeToOpen(resolved.abs)) {
        throw new IpcError('FORBIDDEN', t('No se abren ejecutables: usa «Mostrar en la carpeta»'))
      }
      const error = await shell.openPath(resolved.abs)
      if (error) throw new IpcError('INTERNAL', t('No se pudo abrir: {error}', { error }))
    })
  )

  // --- CLAUDE.md del proyecto ---------------------------------------------------

  async function projectRoot(projectId: string): Promise<string> {
    return resolveRoot({ projectId }, deps)
  }

  handle('claudeMd:read', ({ projectId }) =>
    guarded(async () => readClaudeMd(await projectRoot(projectId), deps.claudeDir()))
  )

  handle('claudeMd:write', ({ projectId, text, expectedHash }) =>
    guarded(async () => {
      const result = await writeClaudeMd(
        await projectRoot(projectId),
        deps.claudeDir(),
        text,
        expectedHash
      )
      if (result.ok) logger.info('claude-md', 'CLAUDE.md guardado')
      return result
    })
  )

  // --- Exportar a Markdown --------------------------------------------------------

  /** Solo se revelan en el explorador las rutas exportadas en esta ejecución. */
  const exported = new Set<string>()

  handle('sessions:export', async ({ sessionId, tools }, event) => {
    const payload = await deps.transcripts.transcript(sessionId)
    if (!payload) throw new IpcError('NOT_FOUND', t('La sesión ya no existe'))
    const detail = deps.projects.session(sessionId)
    const options: Electron.SaveDialogOptions = {
      title: t('Exportar sesión a Markdown'),
      defaultPath: join(app.getPath('documents'), exportFileName(detail?.title ?? 'sesion')),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const markdown = toMarkdown(payload, detail, { tools, now: new Date() })
    await writeFile(result.filePath, markdown, 'utf8')
    exported.add(pathKey(result.filePath))
    logger.info('export', `Sesión exportada (${markdown.length} caracteres)`)
    return { path: result.filePath }
  })

  handle('files:revealExport', ({ path }) => {
    if (!exported.has(pathKey(path))) throw new IpcError('FORBIDDEN', t('Ruta no exportada'))
    shell.showItemInFolder(path)
  })
}
