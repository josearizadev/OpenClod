import { diffLines } from 'diff'

/**
 * Diff por líneas de `Edit` (`old_string` → `new_string`). Sale de la
 * entrada de la herramienta, así sirve igual para el chat en vivo.
 */

export type DiffRow =
  | { type: 'add' | 'del' | 'ctx'; text: string }
  /** Líneas de contexto plegadas entre dos cambios. */
  | { type: 'skip'; count: number }

export function lineDiff(before: string, after: string, context = 3): DiffRow[] {
  const rows: Exclude<DiffRow, { type: 'skip' }>[] = []
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, '').split('\n')
    const type = part.added ? 'add' : part.removed ? 'del' : 'ctx'
    for (const text of lines) rows.push({ type, text })
  }
  if (rows.every((row) => row.type === 'ctx')) return rows
  // Contexto: solo `context` líneas alrededor de cada cambio.
  const keep = rows.map(() => false)
  rows.forEach((row, i) => {
    if (row.type === 'ctx') return
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep[j] = true
    }
  })
  const out: DiffRow[] = []
  let skipped = 0
  rows.forEach((row, i) => {
    if (keep[i]) {
      if (skipped > 0) out.push({ type: 'skip', count: skipped })
      skipped = 0
      out.push(row)
    } else skipped++
  })
  if (skipped > 0) out.push({ type: 'skip', count: skipped })
  return out
}
