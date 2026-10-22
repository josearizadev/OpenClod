import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ProjectSettings,
  ProjectSettingsPatch,
  ProjectSettingsWrite,
  SettingsLayer
} from '../../shared/project-settings'
import { hashText } from './claude-md'
import { isInside } from './paths'

/**
 * Ajustes del proyecto. Lee tres capas de ajustes de Claude Code
 * con lista blanca de claves (nunca `env` ni otras) y escribe solo el archivo personal del
 * proyecto, conservando lo que no gestiona, de forma atómica y si nadie lo cambió desde que se
 * leyó. Nunca escribe dentro de la carpeta de Claude Code.
 */

/** Tamaño máximo que se lee de un archivo de ajustes. */
const SETTINGS_MAX = 1024 * 1024

type Obj = Record<string, unknown>

export class ProjectSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectSettingsError'
  }
}

function localSettingsPath(root: string): string {
  return join(root, '.claude', 'settings.local.json')
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

interface RawFile {
  exists: boolean
  text: string | null
  /** Contenido como objeto; `null` si no existe o no es un objeto JSON. */
  data: Obj | null
  invalid: boolean
}

async function readRaw(path: string): Promise<RawFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { exists: false, text: null, data: null, invalid: false }
  }
  if (text.length > SETTINGS_MAX) return { exists: true, text, data: null, invalid: true }
  try {
    const data: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    return isObj(data)
      ? { exists: true, text, data, invalid: false }
      : { exists: true, text, data: null, invalid: true }
  } catch {
    return { exists: true, text, data: null, invalid: true }
  }
}

function coAuthorOf(data: Obj): boolean | null {
  const attribution = data['attribution']
  if (isObj(attribution) && typeof attribution['commit'] === 'string')
    return attribution['commit'] !== ''
  if (typeof data['includeCoAuthoredBy'] === 'boolean') return data['includeCoAuthoredBy']
  return null
}

function layerOf(path: string, raw: RawFile): SettingsLayer {
  const data = raw.data ?? {}
  const permissions = isObj(data['permissions']) ? data['permissions'] : {}
  const mode = permissions['defaultMode']
  return {
    path,
    exists: raw.exists,
    ...(raw.invalid ? { invalid: true as const } : {}),
    allow: strings(permissions['allow']),
    ask: strings(permissions['ask']),
    deny: strings(permissions['deny']),
    defaultMode: typeof mode === 'string' ? mode : null,
    coAuthor: coAuthorOf(data)
  }
}

function checkPath(path: string, claudeDir: string): void {
  if (isInside(path, claudeDir)) {
    throw new ProjectSettingsError(
      'Los ajustes de este proyecto están en la carpeta de Claude Code: no se editan desde aquí.'
    )
  }
}

export async function readProjectSettings(
  root: string,
  claudeDir: string,
  chrome = false
): Promise<ProjectSettings> {
  const localPath = localSettingsPath(root)
  const sharedPath = join(root, '.claude', 'settings.json')
  const userPath = join(claudeDir, 'settings.json')
  const [local, shared, user] = await Promise.all([
    readRaw(localPath),
    readRaw(sharedPath),
    readRaw(userPath)
  ])
  return {
    local: {
      ...layerOf(localPath, local),
      hash: local.text === null ? null : hashText(local.text)
    },
    shared: layerOf(sharedPath, shared),
    user: layerOf(userPath, user),
    chrome
  }
}

/** Aplica el cambio a una copia del contenido: solo las claves que gestiona la app. */
function applyPatch(data: Obj, patch: ProjectSettingsPatch): Obj {
  const next: Obj = { ...data }
  const permissions: Obj = isObj(next['permissions']) ? { ...next['permissions'] } : {}
  const lists = { allow: patch.allow, ask: patch.ask, deny: patch.deny }
  for (const [key, rules] of Object.entries(lists)) {
    const unique = [...new Set(rules.map((r) => r.trim()))]
    if (unique.length > 0) permissions[key] = unique
    else delete permissions[key]
  }
  if (patch.defaultMode === null) delete permissions['defaultMode']
  else if (patch.defaultMode !== undefined) permissions['defaultMode'] = patch.defaultMode
  if (Object.keys(permissions).length > 0) next['permissions'] = permissions
  else delete next['permissions']

  if (patch.coAuthor !== undefined) {
    delete next['includeCoAuthoredBy']
    const attribution: Obj = isObj(next['attribution']) ? { ...next['attribution'] } : {}
    if (patch.coAuthor) {
      delete attribution['commit']
      delete attribution['pr']
    } else {
      attribution['commit'] = ''
      attribution['pr'] = ''
    }
    if (Object.keys(attribution).length > 0) next['attribution'] = attribution
    else delete next['attribution']
  }
  return next
}

export async function writeProjectSettings(
  root: string,
  claudeDir: string,
  patch: ProjectSettingsPatch,
  expectedHash: string | null,
  chrome = false
): Promise<ProjectSettingsWrite> {
  const path = localSettingsPath(root)
  checkPath(path, claudeDir)
  const raw = await readRaw(path)
  const currentHash = raw.text === null ? null : hashText(raw.text)
  if (currentHash !== expectedHash) {
    return {
      ok: false,
      reason: 'conflict',
      settings: await readProjectSettings(root, claudeDir, chrome)
    }
  }
  if (raw.invalid) {
    throw new ProjectSettingsError(
      `${path} no es JSON válido: corrígelo a mano antes de cambiar los ajustes desde aquí.`
    )
  }
  const next = applyPatch(raw.data ?? {}, patch)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.bitacora-${process.pid}.tmp`
  try {
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
  return { ok: true, settings: await readProjectSettings(root, claudeDir, chrome) }
}
