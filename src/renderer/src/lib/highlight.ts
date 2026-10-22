import type { HighlighterCore, LanguageRegistration } from 'shiki/core'

/**
 * Resaltado de código con shiki. Todo es diferido: el núcleo, el
 * motor de expresiones en JavaScript (sin WebAssembly: la CSP no cambia) y cada gramática se
 * cargan con `import()` la primera vez que un bloque visible las pide. Los colores salen de un
 * tema de variables CSS (`--shiki-*`) que `tokens.css` enlaza con los tokens `--code-*`.
 */

type Grammar = () => Promise<{ default: LanguageRegistration[] }>

// Literales para que Vite parta cada gramática en su propio chunk.
const GRAMMARS: Record<string, Grammar> = {
  ts: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  bat: () => import('shiki/langs/bat.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  ahk: () => import('shiki/langs/ahk.mjs')
}

const ALIASES: Record<string, string> = {
  typescript: 'ts',
  mts: 'ts',
  javascript: 'js',
  mjs: 'js',
  cjs: 'js',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  cmd: 'bat',
  batch: 'bat',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  rs: 'rust',
  golang: 'go',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  autohotkey: 'ahk',
  svg: 'xml'
}

/** Nombre de la gramática de la lista blanca, o `null` si el lenguaje no se resalta. */
export function resolveLanguage(lang: string | undefined | null): string | null {
  const key = (lang ?? '').trim().toLowerCase()
  if (!key) return null
  const name = ALIASES[key] ?? key
  return name in GRAMMARS ? name : null
}

/** Bloques más largos se quedan sin resaltar (coste). */
export const MAX_HIGHLIGHT_LINES = 2000
const CACHE_SIZE = 300

let highlighter: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()
const cache = new Map<string, string>()
let warned = false

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: 'bitacora', variablePrefix: '--shiki-' })],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true })
    })
  })()
  return highlighter
}

async function ensureLanguage(core: HighlighterCore, name: string): Promise<void> {
  let pending = loading.get(name)
  if (!pending) {
    pending = (GRAMMARS[name] as Grammar)().then((mod) => core.loadLanguage(...mod.default))
    loading.set(name, pending)
  }
  await pending
}

/** Hash corto (FNV-1a) para la clave de la caché. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + text.length.toString(36)
}

/**
 * HTML resaltado del **contenido** de `<code>` (solo `<span>` con `style="color:var(--shiki-…)"`
 * y el código escapado por shiki), o `null` si no se resalta: lenguaje fuera de la lista,
 * bloque demasiado largo o shiki no cargó.
 */
export async function highlight(
  code: string,
  lang: string | undefined | null
): Promise<string | null> {
  const name = resolveLanguage(lang)
  if (!name) return null
  if (code.split('\n').length > MAX_HIGHLIGHT_LINES) return null
  const key = `${name}:${hash(code)}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // LRU: lo usado pasa al final.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  try {
    const core = await getHighlighter()
    await ensureLanguage(core, name)
    const html = core.codeToHtml(code.replace(/\n$/, ''), { lang: name, theme: 'bitacora' })
    const inner = /<code[^>]*>([\s\S]*)<\/code>/.exec(html)?.[1] ?? null
    if (inner === null) return null
    cache.set(key, inner)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
    return inner
  } catch (error) {
    if (!warned) {
      warned = true
      console.error('No se pudo resaltar el código:', error)
    }
    loading.delete(name)
    return null
  }
}
