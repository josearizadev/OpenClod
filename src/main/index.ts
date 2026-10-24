import type Database from 'better-sqlite3'
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  screen,
  shell
} from 'electron'
import trayIcon from '../../resources/tray.png?asset'
import type { AppCommand } from '../shared/types'
import { buildMenuTemplate } from './menu'
import { restoreBounds } from './services/window-state'
import { createTray, type AppTray } from './tray'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { emitChatEvent, registerChatIpc } from './ipc/chat'
import { registerClaudeIpc } from './ipc/claude'
import { registerIndexIpc } from './ipc/index'
import { registerProjectsIpc } from './ipc/projects'
import { registerSearchIpc } from './ipc/search'
import { registerUsageIpc } from './ipc/usage'
import { registerFilesIpc } from './ipc/files'
import { registerProjectSettingsIpc } from './ipc/project-settings'
import { pathKey } from './services/paths'
import { registerTerminalIpc } from './ipc/terminal'
import { setupTerminal } from './terminal-setup'
import { stripParentClaudeEnv } from './services/env'
import { createGitService } from './services/git'
import { createNotifier, type AppNotification } from './services/notifier'
import { LimitsService } from './services/limits'
import { runUsageProbe, type ProbeFactory } from './services/usage-probe'
import { indexLimits } from './services/usage-report'
import { registerSettingsIpc } from './ipc/settings'
import { registerSystemIpc } from './ipc/system'
import { createAppStore } from './services/app-store'
import { ChatService } from './services/chat/chat-service'
import type { QueryFactory } from './services/chat/chat-session'
import { baseOptions, resolveClaudeExecutable } from './services/chat/claude-runtime'
import { resolveClaudeDir } from './services/claude-paths'
import { createClaudeWatcher, projectsDirOf } from './services/claude-watcher'
import { indexStatus } from './services/index-queries'
import { openIndex, openIndexReader, SCHEMA_VERSION } from './services/index-schema'
import { createIndexService, type IndexService, type WorkerData } from './services/index-service'
import workerPath from './services/index-worker?modulePath'
import { createProjectsService } from './services/projects'
import { trashSessions } from './services/session-trash'
import { initLogger, logger } from './services/logger'
import { createTranscriptService } from './services/transcript'
import { createTranscriptFollower } from './services/transcript-follower'
import type { IndexStatus } from '../shared/projects'
import { createMainWindow, hardenSession } from './window'
import { autoUpdater } from 'electron-updater'
import { registerUpdateIpc } from './ipc/update'
import { createAppUpdater } from './services/updater'
import { mainLocale, setMainLocale, t } from './i18n'
import { registerAuthIpc } from './ipc/auth'
import { readAuthStatus } from './services/auth'
import { isAppUrl } from './window'

// En desarrollo, `userData` propia: la versión instalada y la de desarrollo no comparten
// `state.json`, índice ni logs. Tiene que ir antes de cualquier uso de `userData`.
// La instalada sigue en `bitacora` tras el cambio de nombre a OpenClod: Electron
// la deriva de `name` y, si no, se perderían ajustes, índice y logs.
app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'bitacora' : 'bitacora-dev'))

initLogger(join(app.getPath('userData'), 'logs'), { echo: is.dev })

// Arrancada desde una sesión de Claude Code, la app no debe pasar sus marcadores a los procesos
// de Claude Code que lanza (chat, sonda, terminal): no guardarían la transcripción.
const strippedMarkers = stripParentClaudeEnv(process.env)
if (strippedMarkers > 0) {
  logger.info('main', `Quitadas ${strippedMarkers} variables heredadas de Claude Code`)
}

process.on('uncaughtException', (error) => logger.error('main', error))
process.on('unhandledRejection', (reason) => logger.error('main', reason))

// Una sola instancia: la segunda trae al frente la ventana de la primera.
// El bloqueo va por `userData`, así que la versión instalada y la de desarrollo conviven.
const singleInstance = app.requestSingleInstanceLock()
let showMainWindow: (() => void) | null = null
if (!singleInstance) app.quit()
else app.on('second-instance', () => showMainWindow?.())

app.whenReady().then(() => {
  if (!singleInstance) return
  logger.info('main', `Arranque · app ${app.getVersion()} · Electron ${process.versions.electron}`)
  electronApp.setAppUserModelId('dev.local.bitacora')

  // F12 abre DevTools en desarrollo; en producción se ignora Ctrl+R.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // El tema se aplica antes de crear la ventana: así su color de fondo y el de la barra de
  // título ya son los correctos y no hay destello al arrancar.
  const store = createAppStore(join(app.getPath('userData'), 'state.json'))
  nativeTheme.themeSource = store.get().theme
  const applyLocale = (): void =>
    void setMainLocale(store.get().language, app.getPreferredSystemLanguages())
  applyLocale()
  // El preload lo pide de forma síncrona al cargar cada página.
  ipcMain.on('i18n:locale', (event) => {
    const url = event.senderFrame?.url
    event.returnValue = typeof url === 'string' && isAppUrl(url) ? mainLocale() : 'es'
  })

  // El índice se comprueba antes de crear la ventana: si está corrupto o es de otra versión se
  // recrea. Si ni así se puede abrir, se registra y la app sigue sin índice.
  const dbFile = join(app.getPath('userData'), 'bitacora.db')
  const opened = openIndexReaderChecked(dbFile)
  const reader = opened.reader
  const resolvedClaudeDir = (): ReturnType<typeof resolveClaudeDir> =>
    resolveClaudeDir({
      configured: store.get().claudeDir,
      env: process.env,
      home: app.getPath('home')
    })
  const claudeDir = (): string => resolvedClaudeDir().dir

  // Vigilancia de la carpeta de Claude Code. Arranca tras la primera
  // pasada; cada lote lanza una pasada incremental.
  // El transcript no espera a la pasada: lee lo nuevo de la sesión abierta en paralelo.
  const onBatch = (paths: string[]): void => {
    indexService?.refresh().catch((error) => logger.error('index', error))
    follower.onPaths(paths).catch((error) => logger.error('follower', error))
  }
  const watcher = createClaudeWatcher({ projectsDir: () => projectsDirOf(claudeDir()), onBatch })

  const statusOf = (running: boolean): IndexStatus => {
    if (!reader) return errorStatus(dbFile, opened.error ?? t('No se pudo abrir el índice'))
    try {
      return { ...indexStatus(reader, { path: dbFile, running }), watch: watcher.status() }
    } catch (error) {
      logger.error('index', error)
      return errorStatus(dbFile, error instanceof Error ? error.message : String(error))
    }
  }

  // El worker es el único que escribe; se crea con la primera pasada, tras mostrar la ventana.
  const indexService: IndexService | null = reader
    ? createIndexService({
        createWorker: () => new Worker(workerPath, { workerData: { dbFile } satisfies WorkerData }),
        claudeDir,
        status: statusOf,
        notify: (payload) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.webContents.isDestroyed()) win.webContents.send('index:updated', payload)
          }
          limits.fromIndex()
        }
      })
    : null
  app.on('will-quit', () => {
    watcher.dispose()
    void indexService?.dispose()
    reader?.close()
  })

  const follower = createTranscriptFollower({
    emit: (target, event) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.webContents.id === target && !w.webContents.isDestroyed()) {
          w.webContents.send('sessions:appended', event)
        }
      }
    },
    // La continuación se abre por su entrada de la lista: la última sesión de la conversación.
    resolveEntry: (sessionId) => transcripts.resumeTarget(sessionId)?.sessionId ?? sessionId
  })
  const transcripts = createTranscriptService({ reader, claudeDir, follower })
  const projectsService = createProjectsService({ store, reader, claudeDir })
  // Git de solo lectura.
  const git = createGitService({ projects: () => store.get().projects, log: logger })

  // Cada sesión de chat activa es un proceso de Claude Code.
  const claudePath = resolveClaudeExecutable()
  const runtimeOptions = (): ReturnType<typeof baseOptions> => {
    const resolved = resolvedClaudeDir()
    return baseOptions({
      ...(claudePath ? { claudePath } : {}),
      claudeDir: resolved.dir,
      customClaudeDir: resolved.source === 'settings'
    })
  }

  // Límites de uso: chats abiertos, sonda, avisos del índice y estimación.
  const limits = new LimitsService({
    emit: (snapshot) => {
      for (const w of BrowserWindow.getAllWindows())
        if (!w.webContents.isDestroyed()) w.webContents.send('usage:limits', snapshot)
    },
    readIndex: () => {
      if (!reader) return null
      try {
        return indexLimits(reader)
      } catch (error) {
        logger.error('usage', error)
        return null
      }
    },
    chatUsage: () => chat.readUsage(),
    probe: () =>
      runUsageProbe(sdkQuery as unknown as ProbeFactory, {
        ...runtimeOptions(),
        cwd: app.getPath('userData')
      }),
    probeEnabled: () => store.get().usage.probe,
    save: (snapshot) => {
      try {
        store.set({ limitsCache: { ...snapshot, probe: { state: 'idle' } } })
      } catch (error) {
        logger.error('usage', error)
      }
    },
    cache: store.get().limitsCache,
    log: logger
  })
  app.on('will-quit', () => limits.dispose())

  // Notificaciones del sistema: observan los eventos del chat.
  let mainWindow: BrowserWindow | null = null
  const showWindow = (): void => {
    const w = mainWindow
    if (!w || w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  showMainWindow = showWindow
  const sendCommand = (command: AppCommand): void => {
    showWindow()
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('app:command', { command })
    }
  }
  /** Se guardan hasta que se cierran: si no, el recolector se lleva el `click`. */
  const shown = new Set<Notification>()
  const notifier = createNotifier({
    settings: () => store.get().notifications,
    focused: () => {
      const w = mainWindow
      return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
    },
    titleOf: (sessionId) => {
      try {
        return projectsService.session(sessionId)?.title ?? null
      } catch {
        return null
      }
    },
    show: (n: AppNotification) => {
      if (!Notification.isSupported()) return
      // Solo el tipo: ni título ni texto en el log.
      logger.info('notify', `Notificación mostrada (${n.kind})`)
      const notification = new Notification({ title: n.title, body: n.body })
      shown.add(notification)
      const forget = (): void => void shown.delete(notification)
      notification.on('close', forget)
      notification.on('click', () => {
        forget()
        showWindow()
        if (n.sessionId && mainWindow && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('app:navigate', { path: `/sesion/${n.sessionId}` })
        }
      })
      notification.show()
    }
  })

  const chat = new ChatService({
    query: sdkQuery as unknown as QueryFactory,
    base: runtimeOptions,
    claudeDir,
    resumeTarget: (sessionId) => transcripts.resumeTarget(sessionId),
    // Claude en Chrome del proyecto de esa carpeta.
    chromeDefault: (cwd) => {
      const state = store.get()
      const project = state.projects.find((p) => pathKey(p.path) === pathKey(cwd))
      return project ? (state.projectPrefs[project.id]?.chrome ?? false) : false
    },
    emit: (event) => {
      emitChatEvent(event)
      notifier.onChatEvent(event)
      if (event.kind === 'status') scheduleTrayUpdate()
    },
    // La sesión aparece en la lista sin pulsar «Actualizar».
    onTurnEnd: () => {
      indexService?.refresh().catch((error) => logger.error('index', error))
      void limits.requestUsage({ allowProbe: false })
    },
    onRateLimit: (window) => limits.fromChatEvent(window),
    onCatalog: (catalog) => {
      try {
        store.set({ chatCache: { ...catalog, updatedAt: new Date().toISOString() } })
      } catch (error) {
        logger.error('chat', error)
      }
    },
    knownModels: () =>
      store
        .get()
        .chatCache.models.flatMap((m) => (m.resolvedModel ? [m.value, m.resolvedModel] : [m.value]))
  })

  // Cerrar con sesiones trabajando pide confirmación; al confirmar se detiene todo.
  // `quitting` = la app se va (no se oculta en la bandeja); `closingChats` = ya se están cerrando.
  let quitting = false
  let closingChats = false
  /** Con `restart`, en lugar de salir instala la actualización descargada y vuelve a abrir. */
  const quit = (restart = false): void => {
    if (closingChats) return
    closingChats = true
    quitting = true
    terminal.service?.disposeAll()
    void chat.closeAll().finally(() => {
      if (!restart || !updater.install()) app.quit()
    })
  }
  app.on('before-quit', (event) => {
    quitting = true
    if (chat.size === 0 || closingChats) return
    event.preventDefault()
    quit()
  })
  app.on('will-quit', () => {
    terminal.service?.disposeAll()
    tray?.dispose()
  })

  /** Trabajo vivo que se perdería al salir. */
  const busyNow = (): { working: number; waiting: number; terminals: number } => ({
    ...chat.busy(),
    terminals: terminal.service?.running() ?? 0
  })
  /** «Salir» del menú o de la bandeja: con trabajo vivo, la ventana pide confirmación. */
  const requestQuit = (): void => {
    const busy = busyNow()
    if (busy.working + busy.waiting + busy.terminals === 0) return app.quit()
    showWindow()
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('app:closeRequest', busy)
    }
  }

  // Actualizaciones: solo la versión instalada; en desarrollo no hay `app-update.yml`.
  const updater = createAppUpdater({
    updater: app.isPackaged ? autoUpdater : null,
    emit: (status) => {
      for (const w of BrowserWindow.getAllWindows())
        if (!w.webContents.isDestroyed()) w.webContents.send('update:status', status)
    },
    log: logger
  })
  app.on('will-quit', () => updater.dispose())
  /** «Reiniciar para actualizar»: con trabajo vivo, primero lo confirma la ventana. */
  const requestRestart = (): void => {
    const busy = busyNow()
    if (busy.working + busy.waiting + busy.terminals === 0) return quit(true)
    showWindow()
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('app:closeRequest', { ...busy, restart: true })
    }
  }

  // Bandeja: solo con «Mantener en la bandeja al cerrar».
  let tray: AppTray | null = null
  let trayTimer: ReturnType<typeof setTimeout> | null = null
  const trayStatus = (): string | null => {
    const { working, waiting } = chat.busy()
    const parts: string[] = []
    if (working)
      parts.push(
        working === 1 ? t('1 sesión trabajando') : t('{n} sesiones trabajando', { n: working })
      )
    if (waiting)
      parts.push(
        waiting === 1 ? t('1 esperando permiso') : t('{n} esperando permiso', { n: waiting })
      )
    return parts.length ? parts.join(' · ') : null
  }
  const scheduleTrayUpdate = (): void => {
    if (!tray || trayTimer) return
    trayTimer = setTimeout(() => {
      trayTimer = null
      tray?.update()
    }, 1000)
  }
  const syncTray = (closeToTray: boolean): void => {
    if (closeToTray && !tray) {
      try {
        tray = createTray({
          icon: trayIcon,
          onShow: showWindow,
          onNewSession: () => sendCommand('new-session'),
          onQuit: requestQuit,
          status: trayStatus
        })
      } catch (error) {
        logger.error('tray', error)
      }
    } else if (!closeToTray && tray) {
      tray.dispose()
      tray = null
    }
  }

  // Raíz permitida de cada destino y terminal de respaldo.
  const rootDeps = {
    claudeDir,
    projectPath: (id: string) => store.get().projects.find((p) => p.id === id)?.path ?? null,
    sessionCwd: (id: string) =>
      projectsService.session(id)?.cwd ??
      transcripts.resumeTarget(id)?.cwd ??
      chat.snapshot(id)?.cwd ??
      null
  }
  const terminal = setupTerminal({
    ...rootDeps,
    settings: () => store.get().terminal,
    customClaudeDir: () => {
      const resolved = resolvedClaudeDir()
      return resolved.source === 'settings' ? resolved.dir : null
    },
    bundledClaude: claudePath ?? null,
    resumeTarget: (id) => transcripts.resumeTarget(id),
    sessionTitle: (id) => projectsService.session(id)?.title ?? null
  })

  // Menú nativo: en Windows y Linux no se ve; da los atajos. Se rehace al cambiar de idioma.
  const buildMenu = (): void =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate({
          platform: process.platform,
          dev: is.dev,
          appName: 'OpenClod',
          send: sendCommand,
          quit: requestQuit,
          openLogs: () => void shell.openPath(join(app.getPath('userData'), 'logs'))
        })
      )
    )

  hardenSession()
  registerSettingsIpc(
    store,
    () => {
      watcher.restart()
      indexService?.rebuild().catch((error) => logger.error('index', error))
    },
    (settings) => {
      const before = mainLocale()
      applyLocale()
      if (mainLocale() !== before) {
        buildMenu()
        // La bandeja se vuelve a crear con los textos nuevos.
        tray?.dispose()
        tray = null
      }
      syncTray(settings.window.closeToTray)
    }
  )
  registerAuthIpc(() =>
    readAuthStatus({
      claudePath: claudePath ?? null,
      customClaudeDir: () => {
        const resolved = resolvedClaudeDir()
        return resolved.source === 'settings' ? resolved.dir : null
      }
    })
  )
  registerSystemIpc({ gitVersion: () => git.version() })
  registerUpdateIpc(updater, { restart: requestRestart })
  // Eliminar conversaciones: a la papelera, y el índice las quita en la pasada.
  const trash = reader
    ? async (sessionIds: string[]) => {
        const outcome = await trashSessions(sessionIds, {
          reader,
          projectsDir: projectsDirOf(claudeDir()),
          chatState: (id) => chat.chatState(id),
          closeChat: (id) => chat.close(id),
          trash: (path) => shell.trashItem(path)
        })
        if (outcome.conversations.length > 0) {
          projectsService.forget(outcome.conversations)
          logger.info('sessions', `${outcome.conversations.length} conversaciones a la papelera`)
          await indexService?.refresh().catch((error) => logger.error('index', error))
        }
        return { trashed: outcome.trashed, skipped: outcome.skipped }
      }
    : undefined
  registerProjectsIpc(projectsService, transcripts, follower, trash)
  registerFilesIpc({ ...rootDeps, git, projects: projectsService, transcripts })
  registerProjectSettingsIpc({ ...rootDeps, store })
  registerTerminalIpc(terminal.service, terminal.shells)
  // «Actualizar» reintenta la vigilancia si estaba apagada o en sondeo.
  registerIndexIpc(
    indexService,
    () => indexService?.status() ?? statusOf(false),
    () => {
      if (watcher.status().state !== 'watching') watcher.restart()
    }
  )
  registerSearchIpc(reader, store, () => indexService?.progress ?? null)
  registerUsageIpc(reader, store, limits)
  registerClaudeIpc(store)
  registerChatIpc(chat, {
    catalog: () => {
      const { models, commands } = store.get().chatCache
      return { models, commands }
    },
    onQuit: quit
  })
  buildMenu()

  // Ventana con el tamaño y la posición de la última vez.
  const restored = restoreBounds(
    store.get().windowState,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea
  )
  const win = createMainWindow({ bounds: restored.bounds })
  if (restored.maximized) win.maximize()
  mainWindow = win
  const winId = win.webContents.id
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const saveWindowState = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    try {
      store.set({ windowState: { ...win.getNormalBounds(), maximized: win.isMaximized() } })
    } catch (error) {
      logger.error('window', error)
    }
  }
  const saveSoon = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveWindowState, 500)
  }
  win.on('resize', saveSoon)
  win.on('move', saveSoon)
  win.on('maximize', saveSoon)
  win.on('unmaximize', saveSoon)

  win.on('closed', () => {
    follower.untrack(winId)
    terminal.service?.closeOwner(winId)
  })
  win.on('close', (event) => {
    saveWindowState()
    if (quitting) return
    // Con la bandeja activada, cerrar solo oculta: chats y terminales siguen.
    if (tray) {
      event.preventDefault()
      win.hide()
      return
    }
    const busy = busyNow()
    if (busy.working + busy.waiting + busy.terminals === 0) return
    event.preventDefault()
    if (!win.webContents.isDestroyed()) win.webContents.send('app:closeRequest', busy)
  })
  syncTray(store.get().window.closeToTray)
  win.once('ready-to-show', () => {
    logger.info('main', 'Ventana mostrada')
    indexService
      ?.refresh()
      .catch((error) => logger.error('index', error))
      .finally(() => watcher.start())
    if (!indexService) watcher.start()
    updater.start()
  })

  // Sin vigilancia: comprobación cada 30 s, solo con la ventana enfocada.
  let poll: ReturnType<typeof setInterval> | null = null
  const stopPoll = (): void => {
    if (poll) clearInterval(poll)
    poll = null
  }
  win.on('focus', () => {
    stopPoll()
    poll = setInterval(() => {
      if (watcher.status().state === 'polling') onBatch([])
    }, 30_000)
  })
  win.on('blur', stopPoll)
  win.on('closed', stopPoll)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

/**
 * Comprueba el esquema con `openIndex` y deja abierto solo el lector del main; la conexión con
 * escritura es del worker.
 */
function openIndexReaderChecked(file: string): {
  reader: Database.Database | null
  error?: string
} {
  const opened = openIndex(file)
  if (!opened.ok) return { reader: null, error: opened.error }
  try {
    return { reader: openIndexReader(file) }
  } catch (error) {
    logger.error('index', error)
    return { reader: null, error: error instanceof Error ? error.message : String(error) }
  } finally {
    opened.db.close()
  }
}

function errorStatus(path: string, error: string): IndexStatus {
  return {
    path,
    ok: false,
    error,
    schemaVersion: SCHEMA_VERSION,
    files: 0,
    sessions: 0,
    usageEvents: 0,
    usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    hiddenSessions: 0,
    running: false
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
