# OpenClod

App de escritorio para usar Claude Code desde una interfaz propia (muy parecida a la app de Claude) y explorar las sesiones locales de tus proyectos.

> Proyecto personal, no afiliado a Anthropic. Funciona solo con datos locales y con tu instalación/sesión de Claude Code; no gestiona credenciales.

## Qué hace
- **Chat con Claude Code** (Agent SDK): sesiones nuevas o continuar cualquiera, permisos, cola de mensajes, tareas en segundo plano, y adjuntar imágenes o archivos (clip, pegar o soltar).
- **Historial** de las sesiones locales (`~/.claude/projects`) con visor, actualización en vivo y búsqueda global (`Ctrl+K`). Selección múltiple (`Ctrl`/`Mayús`+clic) para ocultar o mover conversaciones a la papelera del sistema.
- **Uso y límites**: medidor de 5 h, vista Uso (`Ctrl+U`) con gráfica, desgloses y bloques.
- **Git y archivos**: rama y cambios del repositorio, panel de archivos con vista previa y diff contra `HEAD`, `CLAUDE.md` del proyecto, exportar a Markdown, notificaciones.
- **Terminal** integrada (`` Ctrl+` ``) para el shell o `claude --resume`.
- **Ajustes** (`Ctrl+,`): tema, carpeta de Claude Code, notificaciones, terminal, bandeja.

## Requisitos (Windows)
- **Node.js 26** (versión exacta en `.nvmrc`) con **npm 11**.
- **Claude Code** con una sesión iniciada (ejecuta `claude` una vez en una terminal e inicia sesión). La app usa esa sesión a través del Agent SDK; no pide ni guarda credenciales.
- **Git** (opcional): sin él, no aparecen el chip de rama ni la lista Git del panel de archivos.
- **Build Tools de Visual Studio** y **Python 3**: hoy no hacen falta, porque `better-sqlite3` y `node-pty` traen binarios precompilados (N-API); solo si hubiera que compilar un módulo nativo.
  Verificado el 2026-10-14 con Build Tools 2026 (18.9.2, MSVC 14.51), Windows SDK 10.0.26100, Python 3.14.7 y Node 26.7.0.

## Arrancar en desarrollo
```bash
npm ci             # instala dependencias (y recompila módulos nativos para Electron en postinstall)
npm run dev        # abre la app con recarga en caliente
```
- npm 11 solo ejecuta los scripts de instalación aprobados en `allowScripts` de `package.json` (Electron, esbuild, electron-winstaller, better-sqlite3, node-pty). Si actualizas alguno de esos paquetes, vuelve a aprobarlo con `npm install-scripts approve <paquete>`.
- En desarrollo los datos van a `%APPDATA%\bitacora-dev` (ajustes, índice y logs), separados de la versión instalada (`%APPDATA%\bitacora`), y ambas pueden estar abiertas a la vez. La vista **Diagnóstico** muestra versiones, estado de SQLite y la ruta del log.
- Si lanzas `npm run dev` desde una sesión de Claude Code, la app quita al arrancar las variables que esa sesión hereda (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`…): con ellas, los procesos de Claude Code que abre no guardarían la transcripción.

## Calidad
```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript (main/preload y renderer)
npm test           # Vitest (tests/unit)
npm run format     # Prettier
```

## Empaquetar
```bash
npm run build:win  # compila y genera el instalador NSIS en dist/
```
- `npm run build` solo compila a `out/`; `npm run build:unpack` deja la app sin instalador en `dist/win-unpacked/`.
- El instalador incluye el ejecutable de Claude Code (`claude.exe`) del Agent SDK y los módulos nativos (`better-sqlite3`, `node-pty`), desempaquetados fuera del `asar`.
- Instalar: ejecuta `dist/OpenClod-<versión>-setup.exe` (permite elegir la carpeta y crea un acceso directo). Si ya hay una versión instalada, el instalador la detecta y pregunta antes de actualizarla. No está firmado.
- El icono se regenera con `powershell -ExecutionPolicy Bypass -File scripts/generar-icono.ps1` a partir de `build/logo-fuente.png`.

## Publicar una versión
```bash
npm run publicar -- <patch|minor|major>   # versión, commit, etiqueta, instalador y subida
```
- Sube a `OPENCLOD_DESTINO` (por defecto `jos-server:/var/www/openclod/`, por `scp`) el instalador, su `.blockmap` y `latest.yml`, que se sirven en `https://openclod.joseariza.dev/`.
- `--sin-subir` deja la versión solo en `dist/`; `--instalar` la instala en silencio sobre la actual.

## Actualizaciones
La versión instalada busca actualizaciones al arrancar y cada 4 horas (`electron-updater`). La versión nueva se descarga en segundo plano; cuando está lista, la app avisa y se instala al pulsar **Reiniciar** (botón del pie de la barra lateral o «Acerca de») o, si no, al salir. Si hay sesiones trabajando, pide confirmación antes de reiniciar.
