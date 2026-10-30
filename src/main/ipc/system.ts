import { app, BrowserWindow, dialog } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from '../services/logger'
import { handle, IpcError } from './handle'
import { t } from '../i18n'
import type { ShellMenuService } from '../services/shell-menu'

/** `claudeCodeVersion` del `package.json` del Agent SDK (la CLI que trae la app). */
function claudeCodeVersion(): string | null {
  try {
    const entry = require.resolve('@anthropic-ai/claude-agent-sdk')
    let dir = dirname(entry)
    for (let i = 0; i < 4; i++) {
      const file = join(dir, 'package.json')
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
          name?: string
          claudeCodeVersion?: string
        }
        if (pkg.name === '@anthropic-ai/claude-agent-sdk') return pkg.claudeCodeVersion ?? null
      }
      dir = dirname(dir)
    }
  } catch {
    // Sin SDK: no hay versión que mostrar.
  }
  return null
}

export function registerSystemIpc(opts: {
  gitVersion: () => Promise<string | null>
  shellMenu: ShellMenuService
}): void {
  handle('system:ping', ({ msg }) => ({ pong: msg }))
  handle('system:info', async () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    logFile: logger.file,
    git: await opts.gitVersion(),
    claudeCode: claudeCodeVersion()
  }))
  handle('system:pickFolder', async (input, event) => {
    const options: Electron.OpenDialogOptions = {
      title:
        input?.purpose === 'claudeDir'
          ? t('Elegir la carpeta de Claude Code')
          : t('Elegir carpeta de trabajo'),
      properties: ['openDirectory']
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('system:pickFiles', async (_input, event) => {
    const options: Electron.OpenDialogOptions = {
      title: t('Adjuntar archivos'),
      properties: ['openFile', 'multiSelections']
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  handle('system:shellMenu', () => opts.shellMenu.status())
  handle('system:setShellMenu', async ({ enabled }) => {
    try {
      const status = enabled
        ? await opts.shellMenu.enable(t('Abrir en OpenClod'))
        : await opts.shellMenu.disable()
      logger.info('system', `Menú del Explorador ${status.enabled ? 'activado' : 'desactivado'}`)
      return status
    } catch (error) {
      logger.error('system', error)
      throw new IpcError('INTERNAL', t('No se pudo cambiar el menú del Explorador.'))
    }
  })
}
