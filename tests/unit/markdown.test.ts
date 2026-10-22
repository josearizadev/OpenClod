import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/renderer/src/lib/markdown'

describe('renderMarkdown', () => {
  it('escapa el HTML crudo en lugar de interpretarlo', () => {
    const html = renderMarkdown('Hola <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('no genera enlaces javascript:', () => {
    const html = renderMarkdown('[pulsa](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
  })

  it('abre los enlaces en ventana nueva sin opener', () => {
    const html = renderMarkdown('[Vue](https://vuejs.org)')
    expect(html).toContain('href="https://vuejs.org"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('pinta los bloques de código con cabecera de lenguaje y botón copiar', () => {
    const html = renderMarkdown('```ts\nconst a = "<b>"\n```')
    expect(html).toContain('<div class="code-block">')
    expect(html).toContain('<span>ts</span>')
    expect(html).toContain('data-copy-code')
    expect(html).toContain('const a = &quot;&lt;b&gt;&quot;')
  })

  it('usa "texto" si el bloque no indica lenguaje y escapa el lenguaje', () => {
    expect(renderMarkdown('```\nx\n```')).toContain('<span>texto</span>')
    expect(renderMarkdown('```<i>\nx\n```')).toContain('<span>&lt;i&gt;</span>')
  })

  it('tolera un bloque de código sin cerrar (texto a medio llegar)', () => {
    expect(renderMarkdown('Mira:\n\n```ts\nconst a')).toContain('const a')
  })
})

describe('renderMarkdown (visor)', () => {
  it('marca el lenguaje de cada bloque con data-lang para el resaltado', () => {
    expect(renderMarkdown('```ts\nconst a = 1\n```')).toContain('<code data-lang="ts">')
    expect(renderMarkdown('```\nx\n```')).toContain('<pre><code>x')
    expect(renderMarkdown('```"><i>\nx\n```')).not.toContain('data-lang=""><i>')
  })

  it('las imágenes remotas salen como enlace, nunca como <img>', () => {
    const html = renderMarkdown('![logo](https://example.com/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://example.com/a.png"')
    expect(html).toContain('🖼 logo')
    const local = renderMarkdown('![x](file:///C:/a.png)')
    expect(local).not.toContain('<img')
    expect(local).not.toContain('href=')
  })

  it('las tablas van envueltas para tener scroll propio', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<div class="md-table"><table>')
    expect(html).toContain('</table></div>')
  })
})
