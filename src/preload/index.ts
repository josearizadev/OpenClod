import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/ipc-contract'
import type { Locale } from '../shared/i18n'
import { invoke, subscribe } from './ipc'

// Solo funciones concretas del contrato: nunca se expone `ipcRenderer`.
// El idioma se pide de forma síncrona: la interfaz lo necesita antes de pintar nada.
function readLocale(): Locale {
  try {
    return ipcRenderer.sendSync('i18n:locale') === 'en' ? 'en' : 'es'
  } catch {
    return 'es'
  }
}

const api: Api = {
  locale: readLocale(),
  auth: {
    status: () => invoke('auth:status', undefined)
  },
  settings: {
    get: () => invoke('settings:get', undefined),
    set: (patch) => invoke('settings:set', patch)
  },
  system: {
    ping: (msg) => invoke('system:ping', { msg }),
    info: () => invoke('system:info', undefined),
    pickFolder: (purpose) => invoke('system:pickFolder', purpose ? { purpose } : undefined),
    pickFiles: () => invoke('system:pickFiles', undefined)
  },
  git: {
    info: (args) => invoke('git:info', args)
  },
  files: {
    read: (args) => invoke('files:read', args),
    diff: (args) => invoke('files:diff', args),
    open: (args) => invoke('files:open', args),
    mentions: (args) => invoke('files:mentions', args),
    revealExport: (path) => invoke('files:revealExport', { path }),
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  terminal: {
    shells: () => invoke('terminal:shells', undefined),
    open: (args) => invoke('terminal:open', args),
    list: () => invoke('terminal:list', undefined),
    attach: (id) => invoke('terminal:attach', { id }),
    write: (id, data) => invoke('terminal:write', { id, data }),
    resize: (id, cols, rows) => invoke('terminal:resize', { id, cols, rows }),
    restart: (id) => invoke('terminal:restart', { id }),
    close: (id) => invoke('terminal:close', { id }),
    onData: (callback) => subscribe('terminal:data', callback),
    onExit: (callback) => subscribe('terminal:exit', callback)
  },
  claudeMd: {
    read: (projectId) => invoke('claudeMd:read', { projectId }),
    write: (args) => invoke('claudeMd:write', args)
  },
  projectSettings: {
    read: (projectId) => invoke('projectSettings:read', { projectId }),
    write: (args) => invoke('projectSettings:write', args),
    setChrome: (projectId, enabled) => invoke('projectSettings:setChrome', { projectId, enabled })
  },
  projects: {
    list: () => invoke('projects:list', undefined),
    import: (path) => invoke('projects:import', { path }),
    importMany: (paths) => invoke('projects:importMany', { paths }),
    remove: (id) => invoke('projects:remove', { id }),
    select: (id) => invoke('projects:select', { id }),
    active: () => invoke('projects:active', undefined),
    discover: () => invoke('projects:discover', undefined)
  },
  sessions: {
    list: (projectId) => invoke('sessions:list', { projectId }),
    get: (sessionId) => invoke('sessions:get', { sessionId }),
    update: (patch) => invoke('sessions:update', patch),
    trash: (sessionIds) => invoke('sessions:trash', { sessionIds }),
    metaStats: () => invoke('sessions:metaStats', undefined),
    transcript: (sessionId) => invoke('sessions:transcript', { sessionId }),
    subagent: (sessionId, agentId) => invoke('sessions:subagent', { sessionId, agentId }),
    follow: (sessionId) => invoke('sessions:follow', { sessionId }),
    export: (args) => invoke('sessions:export', args),
    onAppended: (callback) => subscribe('sessions:appended', callback)
  },
  index: {
    status: () => invoke('index:status', undefined),
    refresh: () => invoke('index:refresh', undefined),
    rebuild: () => invoke('index:rebuild', undefined),
    onUpdated: (callback) => subscribe('index:updated', callback)
  },
  usage: {
    report: (query) => invoke('usage:report', query),
    limits: () => invoke('usage:limits', undefined),
    probe: (force) => invoke('usage:probe', { force }),
    sessionCost: (sessionId) => invoke('usage:sessionCost', sessionId),
    onLimits: (callback) => subscribe('usage:limits', callback)
  },
  search: {
    query: (args) => invoke('search:query', args)
  },
  claude: {
    scan: () => invoke('claude:scan', undefined),
    dir: () => invoke('claude:dir', undefined)
  },
  chat: {
    start: (args) => invoke('chat:start', args),
    send: (args) => invoke('chat:send', args),
    queueEdit: (args) => invoke('chat:queueEdit', args),
    queueRemove: (args) => invoke('chat:queueRemove', args),
    queueSendNow: (args) => invoke('chat:queueSendNow', args),
    interrupt: (sessionId) => invoke('chat:interrupt', { sessionId }),
    permission: (args) => invoke('chat:permission', args),
    setModel: (sessionId, model) => invoke('chat:setModel', { sessionId, model }),
    setMode: (sessionId, mode) => invoke('chat:setMode', { sessionId, mode }),
    setChrome: (sessionId, enabled) => invoke('chat:setChrome', { sessionId, enabled }),
    stopTask: (sessionId, taskId) => invoke('chat:stopTask', { sessionId, taskId }),
    close: (sessionId) => invoke('chat:close', { sessionId }),
    reconciled: (sessionId, uuids) => invoke('chat:reconciled', { sessionId, uuids }),
    snapshot: (sessionId) => invoke('chat:snapshot', { sessionId }),
    active: () => invoke('chat:active', undefined),
    catalog: () => invoke('chat:catalog', undefined),
    onEvent: (callback) => subscribe('chat:event', callback)
  },
  app: {
    quit: (restart) => invoke('app:quit', restart ? { restart } : undefined),
    onCloseRequest: (callback) => subscribe('app:closeRequest', callback),
    onNavigate: (callback) => subscribe('app:navigate', callback),
    onCommand: (callback) => subscribe('app:command', callback)
  },
  update: {
    status: () => invoke('update:status', undefined),
    check: () => invoke('update:check', undefined),
    install: () => invoke('update:install', undefined),
    onStatus: (callback) => subscribe('update:status', callback)
  }
}

contextBridge.exposeInMainWorld('api', api)
