/**
 * Sube la landing (`web/`) al servidor de actualizaciones, junto a los instaladores.
 *
 *   npm run publicar:web
 *
 * Destino `scp` en `OPENCLOD_DESTINO`, por defecto `jos-server:/var/www/openclod/`. No toca
 * `latest.yml`, los instaladores ni `stats.json` (lo escribe el servidor).
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const DESTINO = process.env.OPENCLOD_DESTINO ?? 'jos-server:/var/www/openclod/'
const files = readdirSync('web').map((name) => join('web', name))

console.log(`Subiendo la web a ${DESTINO}…`)
const result = spawnSync('scp', ['-q', '-r', '-o', 'BatchMode=yes', ...files, DESTINO], {
  stdio: 'inherit'
})
if (result.status !== 0) {
  console.error(`No se pudo subir a ${DESTINO}.`)
  process.exit(result.status ?? 1)
}
console.log('Web publicada: https://openclod.joseariza.dev/')
