import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import { describeError } from './logger'
import { clearIndex } from './index-schema'
import { runPass } from './indexer'
import type { WorkerData, WorkerRequest, WorkerResponse } from './index-service'

/**
 * Entrada del worker del índice: el único que escribe en `bitacora.db`. El main ya
 * comprobó el esquema antes de crearlo; aquí solo se abre con escritura y se atienden órdenes de
 * una en una (el main nunca manda otra hasta recibir la respuesta).
 */
const port = parentPort
if (!port) throw new Error('index-worker debe ejecutarse como worker_thread')

const { dbFile } = workerData as WorkerData
const db = new Database(dbFile)
db.pragma('journal_mode = WAL')
// El lector del main puede tener una lectura en curso al hacer checkpoint.
db.pragma('busy_timeout = 2000')

function send(message: WorkerResponse): void {
  port?.postMessage(message)
}

const log = {
  info: (scope: string, message: string): void =>
    send({ type: 'log', level: 'info', scope, message }),
  warn: (scope: string, message: string): void =>
    send({ type: 'log', level: 'warn', scope, message }),
  error: (scope: string, error: unknown): void =>
    send({ type: 'log', level: 'error', scope, message: describeError(error) })
}

port.on('message', (request: WorkerRequest) => {
  void (async () => {
    try {
      if (request.type === 'rebuild') clearIndex(db)
      const result = await runPass(db, request.claudeDir, log, (progress) =>
        send({ type: 'progress', id: request.id, ...progress })
      )
      send({ type: 'done', id: request.id, result })
    } catch (error) {
      log.error('index-worker', error)
      send({
        type: 'error',
        id: request.id,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })()
})
