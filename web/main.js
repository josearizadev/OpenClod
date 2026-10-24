// Landing de OpenClod: idioma, tema, enlace a la última versión, contador de descargas y
// animaciones. La versión inglesa vive en /en/ y comparte este archivo.

const root = document.documentElement
const EN = root.lang === 'en'
const BASE = EN ? '../' : ''
const TEXT = EN
  ? {
      version: 'Version',
      systems: 'Windows 10 and 11',
      license: 'MIT license',
      more: (n) => `${n}+ downloads`,
      number: 'en-US'
    }
  : {
      version: 'Versión',
      systems: 'Windows 10 y 11',
      license: 'Licencia MIT',
      more: (n) => `+ de ${n} descargas`,
      number: 'es-ES'
    }

// Idioma: el elegido se recuerda; sin elección, la raíz lleva a /en/ si el navegador no está
// en español (salvo a los buscadores, que indexan cada versión por su cuenta).
function savedLang() {
  try {
    return localStorage.getItem('idioma')
  } catch {
    return null
  }
}
const saved = savedLang()
const bot = /bot|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent)
const wantsEn =
  saved === 'en' ||
  (!saved &&
    !bot &&
    !(navigator.languages ?? [navigator.language]).some((l) => /^es(-|$)/i.test(l)))
if (!EN && wantsEn) location.replace(`en/${location.hash}`)
else if (EN && saved === 'es') location.replace(`../${location.hash}`)
for (const a of document.querySelectorAll('.lang-switch a')) {
  a.addEventListener('click', () => {
    try {
      localStorage.setItem('idioma', a.lang)
    } catch {
      // Sin almacenamiento: vale para esta visita.
    }
  })
}

// Tema: el del sistema hasta que se elige uno, que se recuerda en este navegador.
function savedTheme() {
  try {
    return localStorage.getItem('tema')
  } catch {
    return null
  }
}
const systemDark = matchMedia('(prefers-color-scheme: dark)')
root.dataset.theme = savedTheme() ?? (systemDark.matches ? 'dark' : 'light')
systemDark.addEventListener('change', (e) => {
  if (!savedTheme()) root.dataset.theme = e.matches ? 'dark' : 'light'
})
document.getElementById('tema').addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
  root.dataset.theme = next
  try {
    localStorage.setItem('tema', next)
  } catch {
    // Sin almacenamiento: el cambio dura hasta recargar.
  }
})

// Última versión: la misma `latest.yml` que lee el actualizador de la app.
async function loadLatest() {
  const res = await fetch(`${BASE}latest.yml`, { cache: 'no-store' })
  if (!res.ok) return
  const yml = await res.text()
  const field = (name) => yml.match(new RegExp(`^${name}:\\s*['"]?([^'"\\n]+)`, 'm'))?.[1]
  const version = field('version')
  const path = field('path')
  const size = Number(yml.match(/^\s+size:\s*(\d+)/m)?.[1])
  if (!version || !path) return

  // Las descargas de la web pasan por /descargar/ para contarlas aparte de las actualizaciones.
  for (const a of document.querySelectorAll('.descargar')) {
    a.href = `${BASE}descargar/${encodeURIComponent(path)}`
    a.rel = 'nofollow'
  }
  const parts = [`${TEXT.version} ${version}`]
  if (size) parts.push(`${Math.round(size / 1024 ** 2)} MB`)
  parts.push(TEXT.systems, TEXT.license)
  for (const el of document.querySelectorAll('#meta, .meta-cta')) el.textContent = parts.join(' · ')
}

// Contador: solo se enseña a partir del primer hito.
const MILESTONES = [100000, 50000, 10000, 5000, 1000, 500]
async function loadDownloads() {
  const res = await fetch(`${BASE}stats.json`, { cache: 'no-store' })
  if (!res.ok) return
  const { descargas } = await res.json()
  const milestone = MILESTONES.find((m) => descargas > m)
  if (!milestone) return
  const badge = document.getElementById('descargas')
  badge.querySelector('span').textContent = TEXT.more(milestone.toLocaleString(TEXT.number))
  badge.hidden = false
}

loadLatest().catch(() => {})
loadDownloads().catch(() => {})

// Aparición al hacer scroll. Sin IntersectionObserver todo queda visible.
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target
        el.classList.add('visible')
        observer.unobserve(el)
        // El retardo escalonado es solo para la entrada; el hover va sin él.
        setTimeout(() => (el.style.transitionDelay = ''), 800)
      }
    },
    { rootMargin: '0px 0px -8% 0px' }
  )
  document
    .querySelectorAll('.section h2, .card, .key-list, .privacy, .steps li, .cta')
    .forEach((el, i) => {
      el.classList.add('reveal')
      el.style.transitionDelay = `${(i % 3) * 70}ms`
      observer.observe(el)
    })
  observer.observe(document.querySelector('.window'))
} else {
  document.querySelector('.window').classList.add('visible')
}
