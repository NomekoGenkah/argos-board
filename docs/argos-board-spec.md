# Argos Board: tablero web local para ver agentes de código trabajando

Documento de requisitos (SRS) y prompt de implementación para Claude Code.
Nombre del proyecto y del repositorio de GitHub: `argos-board`.

**Entorno de desarrollo y ejecución:** Windows 11 con desarrollo dentro de **WSL2 (Ubuntu)**. Los agentes (`claude`, `opencode`, `agy`), el wrapper y el servidor corren dentro de WSL2. El navegador puede ser el de Windows. Target de v1: **Linux (x86_64)**.

## 1. Objetivo

Ver en una sola página web local, en tiempo real, el estado de varios agentes de código CLI que corren en terminales distintas y en proyectos distintos. Los agentes soportados al inicio son:

- Claude Code (`claude`)
- OpenCode con DeepSeek (`opencode`; DeepSeek recomienda OpenCode >= 1.14.24)
- Antigravity CLI (`agy`), el reemplazo de Gemini CLI desde junio de 2026 (binario Go)

La página es **solo de observación**: no lanza, detiene ni controla agentes.

## 2. Alcance

Dentro del alcance (v1):
- Un binario Rust con dos modos: `argos-board serve` y `argos-board run`.
- Tarjetas por agente con: estado, proyecto, rama git, últimas líneas de salida y tiempos.
- Alerta (notificación del navegador y/o sonido) cuando un agente queda esperando aprobación.
- Todo en memoria, sin historial en disco.
- Acceso solo desde `localhost`.

Fuera del alcance (v1):
- Escribir en los agentes o aprobar permisos desde la web.
- Persistencia de historial o de salida de sesiones.
- Acceso desde otros dispositivos de la red.
- Soporte para Windows nativo (ConPTY) y macOS. El código no debe impedirlos (p. ej. aislar lo específico de Unix detrás de módulos), pero no se prueban en v1.

### 2.1 Nota sobre WSL2

- El servidor escucha en `127.0.0.1` dentro de WSL2. Desde un navegador de Windows, `http://localhost:8787` debe funcionar gracias al reenvío de localhost de WSL2 (activo por defecto; también con `networkingMode=mirrored`). **Verificarlo en M1**; si no funciona, documentar la solución en el README en vez de abrir el servidor a `0.0.0.0`.
- Mantener el repositorio y `target/` dentro del sistema de archivos de WSL (`~/...`), no en `/mnt/c/...`, por rendimiento de compilación y de eventos de archivos.
- Las notificaciones del navegador las muestra el navegador de Windows; no hace falta nada del lado de WSL.
- Los directorios de configuración y el token usan rutas de Linux (`~/.config/argos-board/`).

## 3. Arquitectura

```
 terminal 1: argos-board run -- claude   ──┐
 terminal 2: argos-board run -- opencode ──┼─► argos-board serve (127.0.0.1) ──WS──► navegador
 terminal 3: argos-board run -- agy      ──┘
```

### 3.1 `argos-board run [--name N] [--project DIR] -- <comando...>` (wrapper)
- Lanza el comando dentro de un PTY (crate `portable-pty`) y es **transparente**: el usuario sigue usando el agente en su terminal como siempre.
- Pone la terminal local en modo raw, reenvía stdin al PTY y copia la salida del PTY a stdout.
- Propaga el redimensionado de la ventana (SIGWINCH) al PTY y al emulador de pantalla.
- Ctrl+C y demás teclas pasan al hijo sin interpretarse. Propaga el código de salida del hijo.
- Restaura SIEMPRE la terminal al salir (guard con `Drop`, también ante panic o señal).
- Alimenta un emulador de terminal (crate `vt100`) con la misma salida para conocer el contenido real de la pantalla.
- Envía eventos al servidor (sección 4). **Si el servidor no está disponible, el agente debe seguir funcionando igual**: reintentar la conexión en segundo plano y no bloquear ni ensuciar la salida del agente.
- Nombre del agente: `--name` o, si no se da, `<binario>@<carpeta>`. Perfil de detección según el nombre del binario (`claude`, `opencode`, `agy`); cualquier otro usa un perfil genérico.

### 3.2 `argos-board serve [--port 8787]`
- Escucha SOLO en `127.0.0.1` (nunca `0.0.0.0`). Si el puerto está ocupado, falla con un mensaje claro.
- Sirve la página web embebida en el binario (`rust-embed`), sin paso de build de frontend.
- Mantiene el estado de todos los agentes en memoria.
- Empuja actualizaciones a los navegadores por WebSocket (`axum` + `tokio`).

## 4. Modelo de datos y API

Snapshot de un agente (JSON, estable porque lo consumen el tablero y la vista Oficina, sección 9):

```json
{
  "id": "uuid",
  "name": "claude@proyecto-a",
  "kind": "claude | opencode | agy | generic",
  "state": "working | waiting_input | waiting_approval | idle | error | exited | disconnected",
  "state_since": "2026-10-10T20:00:00Z",
  "started_at": "2026-10-10T19:40:00Z",
  "project": "/ruta/al/proyecto",
  "git_branch": "main",
  "last_lines": ["...", "..."],
  "last_output_at": "2026-10-10T20:00:05Z",
  "version": "0.1.0 (abe63f4)"
}
```

Endpoints:
- `GET /api/agents`: snapshot completo.
- `GET /ws` (navegador): eventos `snapshot`, `agent_added`, `agent_updated`, `agent_removed`.
- `GET /ingest` (wrapper, WebSocket): eventos `hello` (id, nombre, kind, project, pid, rama, versión del wrapper), `state`, `git`, `screen` (últimas líneas, throttled) y `exit` (código).

## 5. Estados y detección (la parte frágil: tratarla con cuidado)

| Estado | Significado |
|---|---|
| `working` | Hay salida reciente del PTY (p. ej. en los últimos ~2 s) y no hay prompt de aprobación |
| `waiting_input` | La pantalla actual coincide con un patrón de "hizo una pregunta y espera respuesta" del perfil del agente (p. ej. un menú de opciones). Es el caso habitual en modo automático, donde los agentes no piden permisos sino decisiones |
| `waiting_approval` | La pantalla actual coincide con un patrón de "pide permiso" del perfil del agente |
| `idle` | Sin salida reciente y sin prompt de aprobación (esperando al usuario) |
| `error` | La pantalla coincide con un patrón de error/limite de cuota del perfil |
| `exited` | El proceso hijo terminó |
| `disconnected` | El servidor perdió al wrapper sin recibir `exit` |

Reglas:
- La detección combina (a) actividad de bytes recientes y (b) regex sobre el contenido de pantalla del `vt100`, no sobre el flujo crudo.
- Los patrones viven en un perfil por agente, en un TOML configurable (`~/.config/argos-board/config.toml`), con valores por defecto embebidos.
- **No inventar los textos exactos de los prompts de aprobación.** Implementar un modo `argos-board run --dump-screens <dir> -- <cmd>` que guarde snapshots de pantalla en cada cambio de estado percibido, para calibrar los patrones con sesiones reales de cada agente. Los perfiles iniciales deben quedar marcados como "sin calibrar" hasta hacerlo. *(Hecho el 2026-10-11 para `waiting_input` en los tres agentes y `waiting_approval` en `claude`; una lista de patrones vacía en `src/profiles.toml` significa "sin calibrar". Los patrones se buscan en las últimas 25 líneas de la pantalla y tienen prioridad sobre la actividad.)*
- Histéresis: no cambiar de estado por parpadeos de menos de ~500 ms.
- Nota de producto: si un agente se ejecuta sin permisos (p. ej. `agy --dangerously-skip-permissions`), `waiting_approval` no ocurrirá, pero `waiting_input` sí (el agente puede seguir haciendo preguntas). Por defecto `agy` usa el modo `request-review`.

## 6. Página web (solo lectura)

- Una página con una tarjeta por agente sobre un **lienzo**: el usuario mueve (arrastrando la cabecera) y redimensiona cada tarjeta; las tarjetas se empujan entre sí y nunca se superponen. Posición y tamaño se recuerdan por nombre de agente en el navegador. Las actualizaciones en vivo no mueven tarjetas. Las tarjetas nuevas se colocan en el primer hueco libre, y un botón "Reordenar" las acomoda por estado (esperando respuesta o aprobación primero) y luego por nombre. En pantallas estrechas se apilan en una columna.
  *(Cambio respecto a la versión inicial, que ordenaba siempre por estado: el reordenamiento automático hacía saltar las tarjetas cada vez que un agente producía salida.)*
- Cada tarjeta: nombre, indicador de estado con color y texto (no solo color), proyecto (ruta corta), rama git, "en este estado desde hace X" y duración de la sesión, y un recuadro monoespaciado con la salida de la pantalla del agente (unas 8 líneas con el tamaño por defecto; más al agrandar la tarjeta).
- Indicador de conexión con el servidor y reconexión automática del WebSocket.
- Alerta al entrar en `waiting_input` o `waiting_approval`: notificación del navegador (pedir permiso con un botón explícito del usuario), sonido opcional, y contador en el título de la pestaña. Sin alertas duplicadas por el mismo evento (clave: agente + estado + `state_since`; las ya avisadas se recuerdan por pestaña en `sessionStorage`, y al abrir la página no se avisa de lo que ya estaba esperando: lo muestra el contador).
- Tarjetas `exited`/`disconnected` quedan atenuadas y desaparecen tras 10 minutos.
- HTML, CSS y JS planos, sin framework ni build. Se permiten librerías JS sin dependencias ni build, incluidas en `web/vendor/` con su licencia y embebidas en el binario (nunca desde un CDN: sin llamadas de red salientes). Hoy: gridstack.js para el lienzo. Separar claramente la capa de **datos** (WebSocket + estado) de la capa de **render** así conviven el tablero (DOM) y la Oficina (canvas, sección 9) sin tocar el resto.
- Responsive y accesible (contraste, foco, `aria-live` para cambios de estado). Verificado con axe (WCAG 2.1 AA) en ambos temas y a 360 px; el orden del DOM sigue la posición visual del lienzo y solo se anuncian, agrupados, los cambios que requieren atención.
- La cabecera muestra la versión del servidor (versión + commit). `version` en el snapshot es la del wrapper (`null` si es anterior a ese campo); si no coincide, la tarjeta lo avisa. El evento `snapshot` de `/ws` incluye `server_version`.

## 7. Proyecto y rama git

- Proyecto: `--project` o el directorio de trabajo del wrapper.
- Rama: leer `git rev-parse --abbrev-ref HEAD` en ese directorio al inicio y cada ~5 s. Manejar HEAD detached (mostrar hash corto) y carpetas sin git (mostrar vacío).

## 8. Seguridad y privacidad

- Bind solo a loopback. En el WebSocket del navegador validar la cabecera `Origin`/`Host` (evita rebinding DNS y páginas externas leyendo el tablero).
- El endpoint de ingesta exige un token generado al iniciar `serve` y guardado en un archivo con permisos `0600` en el directorio de configuración; el wrapper lo lee de ahí.
- La salida de terminal puede contener secretos. No se escribe a disco, no sale de la máquina y se aplica una redacción básica por regex (claves tipo `sk-...`, `Bearer ...`, variables `*_KEY=`/`*_TOKEN=`) antes de enviar `last_lines`.
- Sin llamadas de red salientes.

## 9. Vista Oficina (pixel-art)

*(Antes "preparación para v2"; implementada el 2026-10-11, issue #16.)* Una segunda vista de los mismos datos, elegida con un botón *Tablero / Oficina* de la cabecera y recordada en el navegador. Objetivo: ver de un vistazo quién trabaja, quién espera una decisión y quién terminó, sin complejidad de juego.

- Renderizador propio (`web/office.js`, canvas 2D con escala entera y `image-rendering: pixelated`) suscrito a la capa de datos como el tablero y las alertas. Sprites propios definidos como texto (`web/sprites.js`), recoloreados por `kind`; sin assets externos ni dependencias.
- Cada agente es una **mascota** de una misma familia de bichitos de bloque, con forma y color propios por `kind`: Claude (bloque naranja con cuatro patas), Antigravity (domo azul que flota, con antena), OpenCode (robot blanco con la cara como pantalla de terminal; trabajando muestra `>_`), otros (cubito marrón).
- **Lugares en un mismo plano**, cada uno con su piso, tabiques y cartel; el lugar dice el estado de un vistazo:
  - *Te esperan* (`waiting_input`, `waiting_approval`): fila frente al escritorio del usuario, por orden de llegada (`state_since`); con un cartel **?** que saltan o un papel para firmar y globo ✋. El cartel de la zona muestra cuántos esperan.
  - *Oficina* (`working`, `error`, `disconnected`): en su escritorio. Tecleando con el monitor como miniatura de `last_lines`; con error, ojos en X, monitor rojo con humo y globo **!**; desconectado, gris con estática y globo "…".
  - *Cocina* (`idle`): sentados a una mesa con su taza.
  - *Salida* (`exited`): junto a la puerta con un maletín, despidiéndose.
- Cada agente conserva su escritorio (asiento estable por nombre, guardado en el navegador) aunque esté en otro lugar; el escritorio vacío muestra su nombre y un salvapantallas. Al cambiar de estado la mascota camina de un lugar a otro; un agente nuevo entra por la puerta.
- La pared tiene una ventana con el cielo según la hora, un calendario con mes y día, el ojo de Argos (mira al primero de la fila) y un reloj con segundero.
- Lo interactivo es HTML sobre el canvas (que es `aria-hidden`): un botón por agente, que sigue a la mascota, con una placa con nombre, estado y tiempo; abre la tarjeta del agente en el Tablero. El orden de Tab va por lugar (te esperan, oficina, cocina, salida).
- Se usa la escala entera más grande con la que el plano entra en la pantalla; en pantallas estrechas los lugares se apilan.
- Con `prefers-reduced-motion` no hay animaciones. Verificado con axe (WCAG 2.1 AA) en ambos temas y a 360 px.

## 10. Stack sugerido (verificar las últimas versiones estables)

`tokio`, `axum` (con WebSocket), `portable-pty`, `vt100`, `crossterm` (modo raw y tamaño), `rust-embed`, `serde`/`serde_json`, `clap`, `regex`, `toml`, `directories`, `tracing`, `anyhow`. Frontend: gridstack.js (vendorizado en `web/vendor/`).

## 11. Hitos

1. **M1:** wrapper transparente (stdin/stdout, resize, código de salida, restauración de terminal) + servidor + página mínima que lista agentes conectados.
2. **M2:** emulación de pantalla con `vt100`, últimas líneas con redacción, proyecto y rama git, tiempos.
3. **M3:** máquina de estados, perfiles por agente, `--dump-screens` y calibración con sesiones reales de `claude`, `opencode` (DeepSeek) y `agy`.
4. **M4:** alertas del navegador y pulido (accesibilidad, reconexión, expiración de tarjetas).

## 12. Pruebas y criterios de aceptación

- Tests unitarios de la máquina de estados usando fixtures de pantalla grabadas.
- Test de integración con un CLI falso (script) que imprime salida, pide "aprobación" y termina.
- Prueba manual con los tres agentes reales en tres proyectos distintos, verificando que:
  1. Cada agente se usa en su terminal exactamente igual que sin wrapper (colores, teclas, redimensionado, Ctrl+C).
  2. Al cerrar el servidor, los agentes siguen funcionando; al reiniciarlo, los wrappers se reconectan.
  3. La tarjeta muestra el estado correcto en trabajo, espera de aprobación e inactividad.
  4. La terminal queda sana después de salir del agente, incluso tras matar el wrapper.
  5. La página no es accesible desde otra máquina de la red.

## 13. Cómo debe trabajar Claude Code

1. Antes de escribir código: confirma que corres en WSL2 Ubuntu (`uname -a`, `cat /proc/version`), verifica `cargo --version` y propón el plan por hitos.
2. Implementa un hito a la vez, con tests, y muéstrame cómo probarlo antes de pasar al siguiente.
3. Donde el documento diga "verificar" o "calibrar", hazlo con datos reales; no inventes textos de prompts ni versiones de crates.
4. Si algo del documento es ambiguo o inviable, dímelo en vez de decidir en silencio.
