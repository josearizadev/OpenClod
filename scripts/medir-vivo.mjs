// Simula una sesión de Claude Code que se escribe en vivo.
//
// Copia una sesión real a una carpeta de Claude Code **de pruebas** y le va añadiendo sus propias
// líneas poco a poco. Nunca escribe en ~/.claude: se niega si el destino está dentro.
//
// Uso:
//   node scripts/medir-vivo.mjs <sesion.jsonl> <carpeta-claude-pruebas> [opciones]
//     --inicio N   líneas iniciales de la copia (por defecto, la mitad)
//     --lote N     líneas que se añaden cada vez (por defecto 3)
//     --cada MS    espera entre lotes (por defecto 1000)
//     --truncar    en lugar de añadir, deja la copia en sus primeras 10 líneas
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const [source, target, ...rest] = process.argv.slice(2)
if (!source || !target) {
  console.error(
    'Uso: node scripts/medir-vivo.mjs <sesion.jsonl> <carpeta-claude-pruebas> [--inicio N] [--lote N] [--cada MS] [--truncar]'
  )
  process.exit(1)
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(rest[i + 1])
}

const real = resolve(homedir(), '.claude')
const dest = resolve(target)
const rel = relative(real, dest)
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) {
  console.error(`Destino dentro de ${real}: no se escribe ahí.`)
  process.exit(1)
}

const lines = readFileSync(source, 'utf8').split('\n').filter(Boolean)
const folder = basename(dirname(resolve(source)))
const id = basename(source, '.jsonl')
const file = join(dest, 'projects', folder, `${id}.jsonl`)
mkdirSync(dirname(file), { recursive: true })

if (rest.includes('--truncar')) {
  writeFileSync(file, lines.slice(0, 10).join('\n') + '\n')
  console.log(`Copia truncada a 10 líneas: ${file}`)
  process.exit(0)
}

let pos = opt('inicio', Math.floor(lines.length / 2))
const batch = opt('lote', 3)
const every = opt('cada', 1000)
if (!existsSync(file)) writeFileSync(file, lines.slice(0, pos).join('\n') + '\n')
else pos = readFileSync(file, 'utf8').split('\n').filter(Boolean).length
console.log(`Sesión ${id}: ${pos} de ${lines.length} líneas en ${file}`)
const timer = setInterval(() => {
  if (pos >= lines.length) {
    clearInterval(timer)
    console.log('Fin: copia completa.')
    return
  }
  const next = lines.slice(pos, pos + batch)
  appendFileSync(file, next.join('\n') + '\n')
  pos += next.length
  console.log(`${new Date().toISOString()} +${next.length} → ${pos}/${lines.length}`)
}, every)
