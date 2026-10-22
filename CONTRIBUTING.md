# Cómo contribuir

Gracias por querer mejorar OpenClod. Toda ayuda es bienvenida: avisos de fallos, ideas y código.

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).

## Antes de empezar
- **Fallos e ideas:** abre un *issue* con la plantilla que corresponda. Busca antes si ya existe uno parecido.
- **Cambios grandes:** abre primero un *issue* para hablarlo. Así no trabajas en algo que luego no encaja.
- **Vulnerabilidades:** no las publiques en un *issue*; sigue [SECURITY.md](SECURITY.md).

## Preparar el entorno
Necesitas Windows, **Node.js 26** (versión exacta en `.nvmrc`) con **npm 11**, y Claude Code con una sesión iniciada para probar el chat.

```bash
git clone https://github.com/<tu-usuario>/OpenClod.git
cd OpenClod
npm ci
npm run dev
```

Más detalles en el [README](README.md).

## Hacer un cambio
1. Haz un *fork* del repositorio y crea una rama desde `main` (`fix/scroll-historial`, `feat/exportar-pdf`…).
2. Haz el cambio y añade o actualiza los tests si toca lógica de `src/main/services/`.
3. Comprueba que todo pasa:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run format
   ```
4. Abre un *Pull Request* contra `main` explicando qué cambia y por qué. Si cambia la interfaz, añade una captura.

## Convenciones
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/es/) en español, con una descripción si el cambio no es obvio. Ejemplo: `fix(historial): mantener el scroll al recargar`.
- **Idioma:** la interfaz, los comentarios y la documentación van en español.
- **TypeScript estricto.** Los tipos compartidos entre main y renderer van en `src/shared`.
- **Renderer sin Node:** todo pasa por `window.api` (preload), y cada argumento IPC se valida con zod en el main.
- **Seguridad Electron:** `contextIsolation`, `sandbox` y sin `nodeIntegration`. No se relajan.
- **Datos de Claude Code:** la carpeta `~/.claude` es de solo lectura, y la app nunca lee, registra ni muestra credenciales.
- **Estilos:** colores siempre mediante los tokens de `src/renderer/src/styles/tokens.css`, nunca valores sueltos.
- **Fixtures:** si añades sesiones de ejemplo en `tests/fixtures/`, anonimízalas (sin nombres, rutas ni datos reales).

## Licencia
Al contribuir aceptas que tu código se publique bajo la [licencia MIT](LICENSE) del proyecto.
