/**
 * Publica una versión nueva de OpenClod.
 *
 *   npm run publicar -- <patch|minor|major> [--instalar]
 *
 * 1. `npm version`: sube la versión de `package.json`, crea el commit `chore(release): vX.Y.Z` y la
 *    etiqueta `vX.Y.Z`. Falla si hay cambios sin confirmar (los archivos sin seguimiento no cuentan).
 * 2. `npm run build:win`: typecheck, compilación e instalador en `dist/`.
 * 3. Con `--instalar`, ejecuta el instalador en silencio sobre la instalación actual (cierra la app
 *    si está abierta y la vuelve a abrir). No hace falta desinstalar: el `appId` es el mismo.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUMPS = ['patch', 'minor', 'major']
const args = process.argv.slice(2)
const bump = args.find((a) => !a.startsWith('--'))
const install = args.includes('--instalar')

if (!BUMPS.includes(bump)) {
  console.error('Uso: npm run publicar -- <patch|minor|major> [--instalar]')
  console.error('  patch: arreglos · minor: funciones nuevas · major: cambios grandes')
  process.exit(1)
}

function run(command) {
  // En Windows `npm` es un .cmd: necesita shell, y con shell va como una sola cadena.
  const result = spawnSync(command, { stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(`npm version ${bump} -m "chore(release): v%s"`)
run('npm run build:win')

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const installer = join('dist', `OpenClod-${version}-setup.exe`)
if (!existsSync(installer)) {
  console.error(`No se encuentra el instalador ${installer}`)
  process.exit(1)
}
console.log(`\nOpenClod ${version} listo: ${installer}`)

if (install) {
  console.log('Instalando sobre la versión actual…')
  spawn(installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
} else {
  console.log(
    'Para instalarla, abre el instalador: actualiza la versión instalada sin desinstalar.'
  )
}
