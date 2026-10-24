import type { ChatEvent, TaskView } from '../../shared/chat'
import type { NotificationSettings } from '../../shared/types'
import { mainLocale, t } from '../i18n'
import { localeTag } from '../../shared/i18n'

/**
 * Notificaciones del sistema. Observa los eventos que ya
 * emite `ChatService` y decide qué avisar; mostrar la notificación lo hace quien lo crea.
 */

export type NotificationKind = 'turnEnd' | 'permission' | 'tasks' | 'limit'

export interface AppNotification {
  kind: NotificationKind
  title: string
  body: string
  /** Sesión que se abre al pulsarla (si ya se conoce). */
  sessionId: string | null
}

export interface NotifierOptions {
  settings: () => NotificationSettings
  /** La ventana tiene el foco (visible y no minimizada). */
  focused: () => boolean
  /** Título de la sesión, o `null` si aún no está en el índice. */
  titleOf: (sessionId: string) => string | null
  show: (notification: AppNotification) => void
  now?: () => number
}

export interface Notifier {
  onChatEvent(event: ChatEvent): void
}

const MIN_GAP_MS = 5000

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

function clip(text: string, max: number): string {
  const line = text.split('\n')[0]!.trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function clock(iso: string): string | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString(localeTag(mainLocale()), { hour: '2-digit', minute: '2-digit' })
}

export function createNotifier(options: NotifierOptions): Notifier {
  const now = options.now ?? Date.now
  const sessions = new Map<string, string>()
  const tasks = new Map<string, Map<string, TaskView['status']>>()
  const last = new Map<string, number>()

  function emit(chatId: string, kind: NotificationKind, body: string): void {
    const settings = options.settings()
    if (!settings.enabled || !settings[kind]) return
    if (options.focused() && !settings.whenFocused) return
    const sessionId = sessions.get(chatId) ?? null
    const key = `${sessionId ?? chatId}:${kind}`
    const previous = last.get(key)
    if (previous !== undefined && now() - previous < MIN_GAP_MS) return
    last.set(key, now())
    const title = (sessionId && options.titleOf(sessionId)) || t('Sesión nueva')
    options.show({ kind, title, body, sessionId })
  }

  return {
    onChatEvent(event) {
      switch (event.kind) {
        case 'session':
          sessions.set(event.chatId, event.sessionId)
          break
        case 'turn-end':
          if (event.result === 'success') {
            emit(
              event.chatId,
              'turnEnd',
              t('Ha terminado · {duration}', { duration: formatDuration(event.durationMs) })
            )
          } else if (event.result === 'error') {
            emit(event.chatId, 'turnEnd', t('Terminó con un error'))
          }
          break
        case 'permission': {
          const { request } = event
          const body =
            request.kind === 'question'
              ? t('Te hace una pregunta')
              : request.kind === 'plan'
                ? t('Tiene un plan para revisar')
                : t('Pide permiso: {tool}', { tool: request.toolName })
          emit(event.chatId, 'permission', body)
          break
        }
        case 'tasks': {
          const before = tasks.get(event.chatId) ?? new Map<string, TaskView['status']>()
          const after = new Map<string, TaskView['status']>()
          for (const task of event.tasks) {
            after.set(task.taskId, task.status)
            const was = before.get(task.taskId)
            if (!task.background || was !== 'running') continue
            if (task.status === 'completed') {
              emit(
                event.chatId,
                'tasks',
                t('Tarea terminada: {task}', { task: clip(task.description, 60) })
              )
            } else if (task.status === 'failed') {
              emit(
                event.chatId,
                'tasks',
                t('Tarea fallida: {task}', { task: clip(task.description, 60) })
              )
            }
          }
          tasks.set(event.chatId, after)
          break
        }
        case 'rate-limit':
          if (event.window.status === 'rejected') {
            const reset = event.window.resetsAt ? clock(event.window.resetsAt) : null
            emit(
              event.chatId,
              'limit',
              reset
                ? t('Límite alcanzado · se renueva a las {time}', { time: reset })
                : t('Límite alcanzado')
            )
          }
          break
        default:
          break
      }
    }
  }
}
