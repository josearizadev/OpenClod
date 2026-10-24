import MarkdownIt from 'markdown-it'
import { t } from '../i18n'

/**
 * Markdown de las respuestas del asistente (visor). `html: false`: el HTML crudo de la
 * respuesta se escapa, nunca se interpreta. markdown-it ya rechaza enlaces `javascript:`,
 * `vbscript:` y `data:` no seguros con su `validateLink` por defecto.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

// Enlaces en ventana nueva: el main los abre en el navegador (`http:`/`https:`) y bloquea la
// navegación de la ventana principal.
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]
  if (token) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, idx, options)
}

// Bloques de código con cabecera (lenguaje + copiar). El botón no lleva
// manejador propio: lo atiende por delegación el componente que muestra el markdown, que
// también resalta después cada `code[data-lang]`.
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  if (!token) return ''
  const lang = md.utils.escapeHtml(token.info.trim().split(/\s+/)[0] ?? '')
  const dataLang = lang ? ` data-lang="${lang}"` : ''
  return (
    '<div class="code-block">' +
    `<div class="code-block-header"><span>${lang || t('texto')}</span>` +
    `<button type="button" class="code-copy" data-copy-code>${t('Copiar')}</button></div>` +
    `<pre><code${dataLang}>${md.utils.escapeHtml(token.content)}</code></pre>` +
    '</div>'
  )
}

// Imágenes: nunca `<img>` (la CSP bloquea lo remoto y el contenido no se carga). Se
// muestran como enlace con el texto alternativo; si la URL no es válida, solo el texto.
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]
  if (!token) return ''
  const src = String(token.attrGet('src') ?? '')
  const alt = md.utils.escapeHtml(token.content || src)
  if (!/^https?:/i.test(src)) return `<span class="md-image">🖼 ${alt}</span>`
  return (
    `<a class="md-image" href="${md.utils.escapeHtml(src)}" target="_blank" ` +
    `rel="noopener noreferrer" title="${md.utils.escapeHtml(src)}">🖼 ${alt}</a>`
  )
}

// Tablas envueltas con scroll horizontal propio: nunca ensanchan la página.
md.renderer.rules.table_open = () => '<div class="md-table"><table>'
md.renderer.rules.table_close = () => '</table></div>'

export function renderMarkdown(source: string): string {
  return md.render(source)
}
