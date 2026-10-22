# Seguridad

## Versiones con soporte
Solo la última versión publicada recibe correcciones. La app se actualiza sola, así que basta con tenerla al día.

## Avisar de una vulnerabilidad
**No abras un *issue* público.** Usa el aviso privado de GitHub:

1. Entra en la pestaña **Security** del repositorio.
2. Pulsa **Report a vulnerability**.
3. Describe el problema, cómo reproducirlo y qué impacto tiene.

Solo lo verá el mantenedor. Intentaré responder en una semana y te tendré al tanto de la corrección. Si quieres, aparecerás en las notas de la versión que lo arregle.

## Qué entra
Sobre todo, cualquier cosa que permita:
- leer o filtrar credenciales de Claude Code o datos de las sesiones fuera del equipo;
- ejecutar código desde el renderer o saltarse el aislamiento de Electron (preload, IPC, CSP);
- escribir en `~/.claude` fuera de la papelera explícita de sesiones;
- servir una actualización manipulada a través de `electron-updater`.

Los fallos de Claude Code o del Agent SDK en sí se avisan a Anthropic, no aquí.
