/**
 * Content-Security-Policy de la app. Fuente única: la usan la etiqueta
 * `<meta>` que inyecta Vite en `index.html` y la cabecera que añade el main.
 * En desarrollo se permite el WebSocket de HMR del servidor de Vite.
 */
export function buildCsp({ dev }: { dev: boolean }): string {
  const connect = dev ? "'self' ws://localhost:* ws://127.0.0.1:*" : "'self'"
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')
}
