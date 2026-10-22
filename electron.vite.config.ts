import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { buildCsp } from './src/shared/csp'

/** Inyecta la CSP como `<meta>` en index.html (con HMR permitido solo en desarrollo). */
function cspMeta(): Plugin {
  return {
    name: 'bitacora-csp-meta',
    transformIndexHtml(_html, ctx) {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: buildCsp({ dev: !!ctx.server })
          },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {},
  // Con `sandbox: true` el preload no puede hacer require de node_modules: se empaqueta todo.
  preload: {
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), tailwindcss(), cspMeta()],
    build: {
      // Las fuentes nunca como data: URI: la CSP solo permite `font-src 'self'`.
      assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined)
    }
  }
})
