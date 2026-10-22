import { app } from 'electron'
import type { ClaudeScanReport } from '../../shared/sessions'
import type { AppStore } from '../services/app-store'
import { resolveClaudeDir } from '../services/claude-paths'
import { scanClaude } from '../services/claude-scan'
import { handle } from './handle'

export function registerClaudeIpc(store: AppStore): void {
  // Un solo análisis a la vez: si se pide otro mientras tanto, recibe el mismo resultado.
  let running: Promise<ClaudeScanReport> | null = null

  handle('claude:scan', () => {
    if (!running) {
      const resolved = resolveClaudeDir({
        configured: store.get().claudeDir,
        env: process.env,
        home: app.getPath('home')
      })
      running = scanClaude(resolved).finally(() => {
        running = null
      })
    }
    return running
  })

  handle('claude:dir', () =>
    resolveClaudeDir({
      configured: store.get().claudeDir,
      env: process.env,
      home: app.getPath('home')
    })
  )
}
