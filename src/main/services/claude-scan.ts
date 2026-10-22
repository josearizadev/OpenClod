import { relative } from 'node:path'
import { EMPTY_USAGE, type ClaudeScanReport } from '../../shared/sessions'
import { listProjects, type ResolvedClaudeDir } from './claude-paths'
import { fingerprintOf, linkConversations, type SessionFingerprint } from './conversations'
import { logger as defaultLogger, type Logger } from './logger'
import { loadSession } from './session-loader'
import { compareVersions } from './session-parser'
import { UsageLedger } from './usage'

/**
 * Análisis de toda la carpeta de Claude Code para Diagnóstico. Lee las
 * sesiones una a una por stream (memoria acotada, el main sigue respondiendo) y agrega el uso con
 * un único ledger: lo que una sesión continuada copia de otra no se cuenta dos veces.
 */

const MAX_ISSUES = 20

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

function merge(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value
}

export async function scanClaude(
  resolved: ResolvedClaudeDir,
  log: Pick<Logger, 'warn'> = defaultLogger
): Promise<ClaudeScanReport> {
  const started = performance.now()
  const report: ClaudeScanReport = {
    dir: resolved.dir,
    source: resolved.source,
    ok: true,
    projects: 0,
    sessions: 0,
    subagents: 0,
    lines: 0,
    invalidLines: 0,
    unknownLineTypes: {},
    unknownBlockTypes: {},
    cliVersions: [],
    usage: { ...EMPTY_USAGE },
    usageEvents: 0,
    sessionsWithIssues: [],
    continuedSessions: 0,
    conversationLinks: 0,
    unlinkedOverlaps: 0,
    brokenLinks: 0,
    linkIssues: [],
    durationMs: 0
  }

  const listing = await listProjects(resolved.dir, log)
  if (!listing.ok) {
    report.ok = false
    report.reason = listing.reason
    report.durationMs = Math.round(performance.now() - started)
    return report
  }

  const ledger = new UsageLedger()
  const versions = new Set<string>()
  report.projects = listing.projects.length
  for (const project of listing.projects) {
    // Las continuaciones se enlazan dentro de cada proyecto.
    const fingerprints: SessionFingerprint[] = []
    for (const ref of project.sessions) {
      const loaded = await loadSession(ref)
      fingerprints.push(fingerprintOf(loaded))
      const diag = loaded.diagnostics
      report.sessions += 1
      report.subagents += loaded.summary.subagents.length
      report.lines += diag.lines
      report.invalidLines += diag.invalidCount
      merge(report.unknownLineTypes, diag.unknownLineTypes)
      merge(report.unknownBlockTypes, diag.unknownBlockTypes)
      for (const version of diag.cliVersions) versions.add(version)
      ledger.add(loaded.usage)
      const unknown = sum(diag.unknownLineTypes) + sum(diag.unknownBlockTypes)
      if ((diag.invalidCount > 0 || unknown > 0) && report.sessionsWithIssues.length < MAX_ISSUES) {
        report.sessionsWithIssues.push({
          file: relative(resolved.dir, ref.file),
          invalidLines: diag.invalidCount,
          unknown
        })
      }
    }
    const graph = linkConversations(fingerprints)
    const conversations = new Map<string, number>()
    for (const link of graph.links.values()) {
      conversations.set(link.conversationId, (conversations.get(link.conversationId) ?? 0) + 1)
      if (link.continuedFrom) report.continuedSessions += 1
    }
    report.conversationLinks += [...conversations.values()].filter((n) => n > 1).length
    report.unlinkedOverlaps += graph.unlinkedOverlaps.length
    report.brokenLinks += graph.brokenLinks.length
    const issues = [
      ...graph.unlinkedOverlaps.map(
        (o) => `${project.name}: ${o.a} y ${o.b} comparten ${o.lines} líneas sin enlace`
      ),
      ...graph.brokenLinks.map(
        (b) => `${project.name}: ${b.sessionId} continúa en ${b.missing}, que no está`
      )
    ]
    report.linkIssues.push(...issues.slice(0, MAX_ISSUES - report.linkIssues.length))
  }
  report.cliVersions = [...versions].sort(compareVersions)
  report.usage = ledger.total()
  report.usageEvents = ledger.size
  report.durationMs = Math.round(performance.now() - started)
  return report
}
