import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONTEXT_FILE_MAX,
  CONTEXT_SEND_MAX,
  isContextName,
  type ComposedContext,
  type ContextFile,
  type ContextFolderListing,
  type ContextPart,
  type ContextWrite
} from '../../shared/context'
import type { SessionFolder } from '../../shared/types'
import type { AppStore } from './app-store'
import { hashText } from './claude-md'
import { t } from '../i18n'

/**
 * Contexto que OpenClod añade a las sesiones que empieza: los `.md` del contexto de cada
 * proyecto (`userData/contexto/proyectos/<projectId>/`) y el de la carpeta de sesiones. El que se
 * aplicó a cada conversación se guarda en `userData/contexto/aplicado/` para reenviarlo igual al
 * continuarla. Nunca toca la carpeta del proyecto ni la de Claude Code.
 */

export class ContextError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_ARGS',
    message: string
  ) {
    super(message)
    this.name = 'ContextError'
  }
}

export interface ProjectContextOptions {
  /** `userData/contexto`. */
  root: string
  store: AppStore
  /** Mover a la papelera del sistema. */
  trash: (path: string) => Promise<void>
}

export interface ComposeInput {
  /** Proyecto de la carpeta de trabajo, o `null` si no es la de ningún proyecto. */
  projectId: string | null
  folder: Pick<SessionFolder, 'name' | 'context'> | null
}

export interface ProjectContextService {
  dirOf(projectId: string): string
  list(projectId: string): Promise<ContextFolderListing>
  read(projectId: string, name: string): Promise<ContextFile>
  write(
    projectId: string,
    name: string,
    text: string,
    expectedHash: string | null
  ): Promise<ContextWrite>
  rename(projectId: string, from: string, to: string): Promise<void>
  remove(projectId: string, name: string): Promise<void>
  setEnabled(projectId: string, name: string, enabled: boolean): void
  /** Crea la carpeta del proyecto (para abrirla) y la devuelve. */
  ensureDir(projectId: string): Promise<string>
  compose(input: ComposeInput): Promise<ComposedContext>
  saveApplied(conversationId: string, text: string): Promise<void>
  readApplied(conversationId: string): Promise<string | null>
  forgetApplied(conversationIds: readonly string[]): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids de conversación: los de Claude Code (uuid) o, en tests, algo sin rutas. */
const CONVERSATION = /^[A-Za-z0-9_-]{1,100}$/

function checkName(name: string): void {
  if (!isContextName(name))
    throw new ContextError('INVALID_ARGS', t('Nombre de archivo no válido.'))
}

function checkProject(projectId: string): void {
  if (!UUID.test(projectId)) throw new ContextError('INVALID_ARGS', 'projectId no válido')
}

/** Compara nombres sin distinguir mayúsculas (Windows). */
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function createProjectContext(options: ProjectContextOptions): ProjectContextService {
  const { root, store } = options
  const projectsDir = join(root, 'proyectos')
  const appliedDir = join(root, 'aplicado')

  function dirOf(projectId: string): string {
    checkProject(projectId)
    return join(projectsDir, projectId)
  }

  function disabledOf(projectId: string): string[] {
    return store.get().projectContext[projectId]?.disabled ?? []
  }

  function setDisabled(projectId: string, disabled: string[]): void {
    const all = { ...store.get().projectContext }
    if (disabled.length > 0) all[projectId] = { disabled }
    else delete all[projectId]
    store.set({ projectContext: all })
  }

  async function files(
    projectId: string
  ): Promise<{ name: string; size: number; mtimeMs: number }[]> {
    let names: string[]
    try {
      names = await readdir(dirOf(projectId))
    } catch {
      return []
    }
    const out: { name: string; size: number; mtimeMs: number }[] = []
    for (const name of names) {
      if (!isContextName(name)) continue
      try {
        const info = await stat(join(dirOf(projectId), name))
        if (info.isFile()) out.push({ name, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // Borrado entre `readdir` y `stat`.
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  async function readOrNull(projectId: string, name: string): Promise<ContextFile | null> {
    const path = join(dirOf(projectId), name)
    try {
      const info = await stat(path)
      if (!info.isFile()) return null
      if (info.size > CONTEXT_FILE_MAX) {
        throw new ContextError('INVALID_ARGS', t('El archivo es demasiado grande (> 200 KB).'))
      }
      const text = await readFile(path, 'utf8')
      return { name, text, hash: hashText(text) }
    } catch (error) {
      if (error instanceof ContextError) throw error
      return null
    }
  }

  return {
    dirOf,

    async list(projectId) {
      const disabled = disabledOf(projectId)
      return {
        dir: dirOf(projectId),
        files: (await files(projectId)).map((f) => ({
          ...f,
          enabled: !disabled.some((d) => same(d, f.name))
        }))
      }
    },

    async read(projectId, name) {
      checkName(name)
      const file = await readOrNull(projectId, name)
      if (!file) throw new ContextError('NOT_FOUND', t('El archivo ya no existe.'))
      return file
    },

    async write(projectId, name, text, expectedHash) {
      checkName(name)
      if (Buffer.byteLength(text, 'utf8') > CONTEXT_FILE_MAX) {
        throw new ContextError('INVALID_ARGS', t('El archivo es demasiado grande (> 200 KB).'))
      }
      const current = await readOrNull(projectId, name)
      // Crear: no debe existir (tampoco con otras mayúsculas). Guardar: no debe haber cambiado.
      const clash =
        expectedHash === null
          ? current !== null || (await files(projectId)).some((f) => same(f.name, name))
          : current?.hash !== expectedHash
      if (clash) return { ok: false, reason: 'conflict', file: current }
      const dir = dirOf(projectId)
      await mkdir(dir, { recursive: true })
      const path = join(dir, name)
      const tmp = `${path}.openclod-${process.pid}.tmp`
      try {
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true })
        throw error
      }
      return { ok: true, file: { name, text, hash: hashText(text) } }
    },

    async rename(projectId, from, to) {
      checkName(from)
      checkName(to)
      if (from === to) return
      const list = await files(projectId)
      if (!list.some((f) => f.name === from)) {
        throw new ContextError('NOT_FOUND', t('El archivo ya no existe.'))
      }
      // Cambiar solo mayúsculas sí vale; otro archivo con ese nombre, no.
      if (list.some((f) => same(f.name, to) && !same(f.name, from))) {
        throw new ContextError('INVALID_ARGS', t('Ya hay un archivo con ese nombre.'))
      }
      await rename(join(dirOf(projectId), from), join(dirOf(projectId), to))
      const disabled = disabledOf(projectId)
      if (disabled.some((d) => same(d, from))) {
        setDisabled(projectId, [...disabled.filter((d) => !same(d, from)), to])
      }
    },

    async remove(projectId, name) {
      checkName(name)
      const path = join(dirOf(projectId), name)
      try {
        await stat(path)
      } catch {
        throw new ContextError('NOT_FOUND', t('El archivo ya no existe.'))
      }
      await options.trash(path)
      setDisabled(
        projectId,
        disabledOf(projectId).filter((d) => !same(d, name))
      )
    },

    setEnabled(projectId, name, enabled) {
      checkName(name)
      const rest = disabledOf(projectId).filter((d) => !same(d, name))
      setDisabled(projectId, enabled ? rest : [...rest, name])
    },

    async ensureDir(projectId) {
      const dir = dirOf(projectId)
      await mkdir(dir, { recursive: true })
      return dir
    },

    async compose({ projectId, folder }) {
      const sections: { part: ContextPart; body: string }[] = []
      if (projectId) {
        const disabled = disabledOf(projectId)
        for (const info of await files(projectId)) {
          if (disabled.some((d) => same(d, info.name))) continue
          const file = await readOrNull(projectId, info.name).catch(() => null)
          const body = file?.text.trim()
          if (!body) continue
          sections.push({
            part: { kind: 'file', name: info.name, chars: body.length },
            body: `## ${t('Contexto del proyecto · {name}', { name: info.name })}\n\n${body}`
          })
        }
      }
      const folderText = folder?.context.trim()
      if (folder && folderText) {
        sections.push({
          part: { kind: 'folder', name: folder.name, chars: folderText.length },
          body: `## ${t('Contexto de la carpeta «{name}»', { name: folder.name })}\n\n${folderText}`
        })
      }
      if (sections.length === 0) return { text: '', parts: [], chars: 0, truncated: false }
      const full = [
        '<openclod-context>',
        t(
          'Contexto que el usuario ha preparado en OpenClod para esta sesión. Tenlo en cuenta como instrucciones, igual que las de CLAUDE.md.'
        ),
        ...sections.map((s) => s.body),
        '</openclod-context>'
      ].join('\n\n')
      const truncated = full.length > CONTEXT_SEND_MAX
      const text = truncated
        ? `${full.slice(0, CONTEXT_SEND_MAX)}\n\n[…]\n</openclod-context>`
        : full
      return { text, parts: sections.map((s) => s.part), chars: full.length, truncated }
    },

    async saveApplied(conversationId, text) {
      if (!CONVERSATION.test(conversationId) || !text) return
      await mkdir(appliedDir, { recursive: true })
      await writeFile(join(appliedDir, `${conversationId}.md`), text, 'utf8')
    },

    async readApplied(conversationId) {
      if (!CONVERSATION.test(conversationId)) return null
      try {
        return await readFile(join(appliedDir, `${conversationId}.md`), 'utf8')
      } catch {
        return null
      }
    },

    async forgetApplied(conversationIds) {
      await Promise.all(
        conversationIds
          .filter((id) => CONVERSATION.test(id))
          .map((id) => rm(join(appliedDir, `${id}.md`), { force: true }))
      )
    }
  }
}
