/**
 * Cola de entrada de una sesión de chat: el `prompt` de `query()` en modo
 * streaming. `interrupt`, `setModel`, `setPermissionMode` y `stopTask` solo funcionan así. Al
 * cerrarla, el iterador termina y el SDK cierra el proceso de Claude Code de forma ordenada.
 */
export class InputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private wake: (() => void) | null = null
  private closedFlag = false

  push(item: T): void {
    if (this.closedFlag) return
    this.items.push(item)
    this.notify()
  }

  close(): void {
    this.closedFlag = true
    this.notify()
  }

  get closed(): boolean {
    return this.closedFlag
  }

  /** Elementos aún no leídos por el SDK. */
  get pending(): number {
    return this.items.length
  }

  private notify(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const next = this.items.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.closedFlag) return
      await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }
}
