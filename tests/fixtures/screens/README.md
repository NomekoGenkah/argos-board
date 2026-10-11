# Pantallas reales de agentes (fixtures)

Capturas de sesiones reales para calibrar la detección de estados (issue #2) y para
los tests de la máquina de estados (issue #3). Grabadas el 2026-10-11 en una terminal
de 120x40 con `argos-board run --dump-screens` y, donde hizo falta, con `tmux capture-pane`.

| Agente | Versión | Modo |
|---|---|---|
| `claude` | Claude Code 2.1.296 (Haiku 5.5) | `auto` (habitual) y `--permission-mode default` |
| `opencode` | OpenCode 1.18.35 con `deepseek/deepseek-flash` | permisos por defecto |
| `agy` | Antigravity CLI 1.3.3 (Gemini 3.8 Flash) | configuración por defecto del usuario |

Se eliminaron datos personales (email, rutas con el usuario). Las rutas del proyecto se
reemplazaron por `/tmp/argos-calib/proyecto`.

## Formato

```
# agente: <claude|opencode|agy>
# categoria: <pregunta|permiso|confianza|fin_de_turno>
# descripcion: ...
# origen: ...
---
<texto de la pantalla>
```

## Categorías

- `pregunta`: el agente hizo una pregunta con opciones y espera la respuesta. En modo
  automático es lo más habitual: el agente no pide permisos, pide decisiones.
- `permiso`: pide aprobación para una herramienta (solo fuera de modo automático).
- `confianza`: diálogo de confianza en la carpeta al abrir el agente en un directorio nuevo.
- `fin_de_turno`: terminó y espera el siguiente mensaje (prompt vacío).

## Hallazgos de la calibración

- Los tres agentes tienen una herramienta de preguntas con opciones y una pista de teclas
  muy reconocible: `Enter to select · ↑/↓ to navigate` (claude), `↑↓ select  enter submit`
  (opencode), `↑/↓ Navigate · enter Select · esc Skip` (agy).
- **La actividad por sí sola no basta.** En la pantalla de permiso de Claude, el `●` de la
  herramienta pendiente parpadea (ver `permiso-bash` y `permiso-bash-parpadeo`), así que el
  texto cambia y la pantalla nunca parece quieta. La coincidencia de un patrón tiene que
  tener prioridad sobre la actividad.
- Antigravity emite bytes sin parar aunque el texto no cambie (cursor, redibujados). Por eso
  la actividad se mide por cambios del texto visible, no por bytes.
- Antigravity, con la configuración actual del usuario, ejecutó comandos que modifican
  archivos sin pedir revisión, así que no hay fixture de permiso para `agy`. OpenCode
  tampoco pidió permisos con su configuración por defecto.
