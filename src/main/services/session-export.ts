import { relative, isAbsolute } from 'node:path'
import type { SessionDetail } from '../../shared/projects'
import type { TranscriptItem, TranscriptPayload } from '../../shared/sessions'
import { localeTag } from '../../shared/i18n'
import { mainLocale, t } from '../i18n'

/**
 * Exportar una sesión a Markdown. Puro: el main pide la ruta
 * y escribe el resultado. Nunca exporta thinking, avisos internos ni lo de los subagentes.
 */

export interface ExportOptions {
  /** Entrada y resultado de cada herramienta, no solo una línea. */
  tools: boolean
  now: Date
  /** Para los tests; por defecto, la zona del sistema. */
  timeZone?: string
}

const DETAIL_MAX = 4000

function dateTime(iso: string | undefined, timeZone?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(localeTag(mainLocale()), {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {})
  })
}

function time(iso: string | undefined, timeZone?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(localeTag(mainLocale()), {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {})
  })
}

/** Valla de código más larga que cualquier racha de comillas invertidas del contenido. */
export function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const bar = '`'.repeat(longest + 1)
  return `${bar}${lang}\n${text.replace(/\n$/, '')}\n${bar}`
}

function clip(text: string, max = DETAIL_MAX): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${t('{n} caracteres más', { n: text.length - max })})`
    : text
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function shortPath(path: string, cwd: string | undefined): string {
  if (cwd && isAbsolute(path)) {
    const rel = relative(cwd, path)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.replace(/\\/g, '/')
  }
  return path.replace(/\\/g, '/')
}

/** Lo más representativo de la entrada de una herramienta, en una línea. */
export function toolSummary(name: string, input: unknown, cwd?: string): string {
  const obj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const path = str(obj['file_path']) ?? str(obj['notebook_path']) ?? str(obj['path'])
  const first =
    (path && shortPath(path, cwd)) ??
    str(obj['command']) ??
    str(obj['pattern']) ??
    str(obj['url']) ??
    str(obj['query']) ??
    str(obj['description']) ??
    str(obj['prompt'])
  const line = (first ?? '').split('\n')[0]!.trim()
  const short = line.length > 100 ? `${line.slice(0, 99)}…` : line
  return short ? `\`${name}\` · ${short.replace(/`/g, "'")}` : `\`${name}\``
}

function header(
  detail: SessionDetail | null,
  payload: TranscriptPayload,
  opts: ExportOptions
): string[] {
  const lines = [`# ${detail?.title ?? t('Sesión de Claude Code')}`, '']
  const start = dateTime(detail?.startedAt, opts.timeZone)
  const end = dateTime(detail?.updatedAt, opts.timeZone)
  if (start) lines.push(`- **${t('Fecha')}:** ${start}${end && end !== start ? ` – ${end}` : ''}`)
  const cwd = payload.cwd ?? detail?.cwd
  if (cwd) lines.push(`- **${t('Carpeta')}:** \`${cwd}\``)
  if (detail?.gitBranch) lines.push(`- **${t('Rama')}:** \`${detail.gitBranch}\``)
  if (detail?.models.length) lines.push(`- **${t('Modelo')}:** ${detail.models.join(', ')}`)
  if (detail) {
    const u = detail.usage
    const total = u.input + u.output + u.cacheCreation + u.cacheRead
    lines.push(`- **Tokens:** ${total.toLocaleString(localeTag(mainLocale()))}`)
  }
  lines.push(`- **${t('Sesión')}:** \`${payload.sessionId}\``)
  lines.push(
    `- **${t('Exportada')}:** ${t('{date} con OpenClod', { date: dateTime(opts.now.toISOString(), opts.timeZone) })}`
  )
  lines.push('', '---', '')
  return lines
}

export function toMarkdown(
  payload: TranscriptPayload,
  detail: SessionDetail | null,
  opts: ExportOptions
): string {
  const out = header(detail, payload, opts)
  const cwd = payload.cwd ?? detail?.cwd
  const results = new Map<string, Extract<TranscriptItem, { kind: 'tool-result' }>>()
  for (const item of payload.items) {
    if (item.kind === 'tool-result') results.set(item.toolUseId, item)
  }
  const segmentStarts = new Map(payload.segments.slice(1).map((s) => [s.firstLine, s] as const))

  /** Autor del último encabezado, para no repetirlo en textos seguidos. */
  let speaker: 'user' | 'claude' | null = null
  const heading = (who: 'user' | 'claude', iso: string | undefined): void => {
    if (speaker === who) return
    speaker = who
    const at = time(iso, opts.timeZone)
    out.push(`### ${who === 'user' ? t('Tú') : 'Claude'}${at ? ` · ${at}` : ''}`, '')
  }

  for (const item of payload.items) {
    const segment = segmentStarts.get(item.line)
    if (segment) {
      segmentStarts.delete(item.line)
      const at = dateTime(segment.startedAt, opts.timeZone)
      out.push('---', '', `_${t('Continuación')}${at ? ` · ${at}` : ''}_`, '')
      speaker = null
    }
    if (item.sidechain) continue
    switch (item.kind) {
      case 'user-prompt': {
        speaker = null
        heading('user', item.timestamp)
        out.push(item.text.trim() || `_(${t('sin texto')})_`)
        if (item.images > 0)
          out.push(
            '',
            `_(${item.images === 1 ? t('1 imagen') : t('{n} imágenes', { n: item.images })})_`
          )
        out.push('')
        break
      }
      case 'command': {
        speaker = null
        heading('user', item.timestamp)
        out.push(`\`${`${item.name} ${item.args}`.trim().replace(/`/g, "'")}\``, '')
        break
      }
      case 'assistant-text': {
        heading('claude', item.timestamp)
        out.push(item.text.trim(), '')
        break
      }
      case 'tool-use': {
        heading('claude', item.timestamp)
        out.push(`> 🔧 ${toolSummary(item.name, item.input, cwd)}`, '')
        if (opts.tools) {
          out.push(fence(clip(JSON.stringify(item.input, null, 2) ?? ''), 'json'), '')
          const result = results.get(item.id)
          if (result && result.text.trim()) {
            out.push(
              result.isError ? `**${t('Error')}:**` : `**${t('Resultado')}:**`,
              '',
              fence(clip(result.text)),
              ''
            )
          }
        }
        break
      }
      case 'command-output': {
        if (opts.tools && item.text.trim()) out.push(fence(clip(item.text)), '')
        break
      }
      case 'subagent-ref': {
        heading('claude', item.timestamp)
        const label = item.description ?? item.agentType ?? item.agentId
        out.push(`> 🤖 ${t('Subagente')}: ${label}`, '')
        break
      }
      case 'interrupted': {
        out.push(`_(${t('interrumpido por el usuario')})_`, '')
        speaker = null
        break
      }
      // thinking, meta, system, attachment, task-notification, tool-result (va con su llamada),
      // unknown: fuera.
      default:
        break
    }
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

/** Nombre de archivo válido en Windows a partir del título. */
export function exportFileName(title: string): string {
  const base = title
    // eslint-disable-next-line no-control-regex -- los caracteres de control no valen en Windows
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim()
  return `${base || 'sesion'}.md`
}
