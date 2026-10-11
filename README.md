# argos-board

Tablero web local para ver en tiempo real el estado de varios agentes de código CLI
(`claude`, `opencode`, `agy`, o cualquier otro comando) que corren en terminales distintas.
Solo observa: no lanza, detiene ni controla agentes.

Especificación completa: [`docs/argos-board-spec.md`](docs/argos-board-spec.md).

> **Estados:** `working` / `idle` (por cambios en la pantalla del agente), `waiting_input` (el agente te hizo una
> pregunta y espera tu respuesta), `waiting_approval` (pide permiso), `error`, `exited` y `disconnected`.
> `waiting_input` está calibrado para `claude`, `opencode` y `agy`; `waiting_approval` solo para `claude`; `error`
> todavía no tiene patrones (ver *Perfiles de detección*).

```
 terminal 1: argos-board run -- claude   ──┐
 terminal 2: argos-board run -- opencode ──┼─► argos-board serve (127.0.0.1) ──WS──► navegador
 terminal 3: argos-board run -- agy      ──┘
```

## Compilar

Requiere Rust estable (probado con 1.98) en Linux / WSL2.

```sh
cargo install --path .
```

Instala el binario en `~/.cargo/bin/argos-board` (normalmente ya está en el `PATH`), así que `argos-board`
funciona desde cualquier carpeta. La página web va embebida en el binario. Después de cambiar el código,
vuelve a ejecutar `cargo install --path .` para actualizar el comando instalado.

## Uso

```sh
# 1. Servidor (una sola vez)
argos-board serve            # http://localhost:8787  (--port para otro puerto)

# 2. Un agente por terminal, envuelto por el wrapper
argos-board run -- claude
argos-board run --name backend -- opencode
argos-board run --project ~/proyectos/x -- agy
```

Abre `http://localhost:8787` en el navegador. El wrapper es transparente: el agente se usa igual que sin él
(colores, teclas, Ctrl+C, redimensionado). Si el servidor no está corriendo, el agente funciona igual y el
wrapper se conecta en cuanto el servidor aparece (también tras reiniciarlo).

### La página

- Una tarjeta por agente, con el color del agente en el borde: Claude Code naranja, Antigravity (`agy`) azul,
  OpenCode blanco y cualquier otro comando marrón. El estado se muestra con texto, icono y color.
- **Lienzo**: arrastra la cabecera de una tarjeta para moverla y su borde derecho, inferior o la esquina para
  redimensionarla. Las tarjetas se empujan entre sí y nunca se superponen; las actualizaciones en vivo no las
  mueven. Al agrandar una tarjeta se ve más de la pantalla del agente. Con el teclado, sobre una tarjeta:
  Mayús+flechas cambia el tamaño y Ctrl+flechas la mueve. *Reordenar* (cabecera) las acomoda por estado y
  restablece los tamaños. La posición y el tamaño se recuerdan por nombre de agente. En pantallas estrechas
  (< 700 px) se apilan en una columna.
- **Quitar**: las tarjetas terminadas o desconectadas tienen un botón *Quitar* que las oculta en ese navegador.
  Si el agente vuelve a cambiar de estado (p. ej. se reconecta), reaparece. El servidor igual las borra solo
  a los 10 minutos.
- **Avisos**: cuando un agente pasa a *Esperando tu respuesta* o *Esperando aprobación*, la pestaña muestra un
  contador (`(1) Argos Board`) y, si activas *Activar avisos*, el navegador muestra una notificación (al hacer clic,
  enfoca la tarjeta). *Sonido* agrega un pitido corto. Un aviso por cada vez que el agente se pone a esperar: no se
  repite por salida nueva ni al recargar la página.
- Modo claro por defecto; el botón de la cabecera cambia a oscuro.
- **Oficina** (botón *Tablero / Oficina* de la cabecera): la misma información en pixel-art. Cada agente es un
  personaje en su escritorio, vestido con el color de su tipo, y su postura dice el estado de lejos:
  - **trabajando**: de espaldas, tecleando, con el monitor lleno de código; el monitor es una miniatura de su
    pantalla real;
  - **esperando tu respuesta**: gira la silla, te saluda con un globo **?** rojo y se ilumina el piso;
  - **esperando aprobación**: te muestra un papel para firmar (globo ✋);
  - **inactivo**: recostado con las manos en la nuca;
  - **error**: agarrándose la cabeza, con el monitor en rojo;
  - **terminado**: la silla vacía con la chaqueta colgada;
  - **desconectado**: un fantasma gris frente a un monitor con estática.

  El ojo de Argos en la pared mira al agente que te necesita. Las ventanas y el reloj siguen la hora real.
  Al hacer clic en un escritorio (o con Tab y Enter) se abre su tarjeta en el Tablero. Los escritorios no se
  mueven con las actualizaciones; los nuevos ocupan el primer hueco libre y *Reordenar* los acomoda por estado.
  Con `prefers-reduced-motion` no hay animaciones. La vista elegida se recuerda en ese navegador.

- **Versión**: la cabecera muestra la versión del servidor (`v0.1.0 (abe63f4)`: versión y commit del build). Si un
  agente usa un wrapper de otra versión (por ejemplo, porque reinstalaste y no lo reiniciaste), su tarjeta lo avisa.
- **Accesibilidad**: sin fallos de axe (WCAG 2.1 AA) en modo claro, oscuro y a 360 px; el orden del teclado sigue la
  posición visual de las tarjetas; los lectores de pantalla oyen solo los cambios importantes (pregunta, permiso,
  error, terminado, desconectado), agrupados.

Las preferencias (tema, lienzo, tarjetas quitadas, sonido) se guardan solo en el navegador (`localStorage`).

### Perfiles de detección

Cada agente tiene patrones (expresiones regulares) que se buscan en las últimas líneas de su pantalla; si uno
coincide, ese estado manda sobre la actividad. Los valores por defecto están en
[`src/profiles.toml`](src/profiles.toml), calibrados con sesiones reales (`tests/fixtures/screens/`). Para
cambiarlos, crea `~/.config/argos-board/config.toml` con las mismas tablas; cada lista que pongas reemplaza a la
por defecto:

```toml
[profiles.claude]
error = ['usage limit reached']

[profiles.generic]          # cualquier otro comando
waiting_input = ['\(y/n\)']
```

Si el archivo tiene un error, `argos-board run` lo avisa al arrancar y usa los valores por defecto.

### Calibrar la detección de estados

```sh
argos-board run --dump-screens ~/argos-dumps/claude -- claude
```

Guarda la pantalla completa (texto) en cada cambio de estado (`working` → `idle`, etc.) y al terminar. Úsalo
para capturar cómo se ve de verdad una pantalla nueva (otro agente, una versión nueva, un error) y escribir sus
patrones. **Los dumps pueden contener secretos de la sesión** (no se redactan): no los
subas al repo sin revisarlos.

## Seguridad

- El servidor escucha solo en `127.0.0.1`; se valida `Host` y `Origin` (protección contra DNS rebinding y páginas externas).
- La ingesta exige un token que `serve` genera al iniciar en `~/.config/argos-board/token` (permisos `0600`).
- Nada se escribe a disco salvo el token (y los dumps si los pides). Las últimas líneas se redactan
  (`sk-...`, `Bearer ...`, `*_KEY=`, `*_TOKEN=`, `*_SECRET=`, `*_PASSWORD=`) antes de salir del wrapper.
- Sin llamadas de red salientes.

## WSL2

- Verificado: desde Windows, `http://localhost:8787` llega al servidor en WSL2 gracias al reenvío de localhost
  (activo por defecto). Si en tu equipo no funciona, revisa `localhostForwarding=true` (o
  `networkingMode=mirrored`) en `%UserProfile%\.wslconfig` y reinicia WSL con `wsl --shutdown`.
  No abras el servidor a `0.0.0.0`.
- Mantén el repo y `target/` dentro del sistema de archivos de WSL (`~/...`), no en `/mnt/c/...`.

### Depurar el wrapper

El wrapper nunca escribe en la terminal del agente. Para ver qué hace (conexión con el servidor, cambios de estado y
si vinieron de un patrón, código de salida), pide un log a un archivo:

```sh
ARGOS_BOARD_LOG=/tmp/argos-wrapper.log argos-board run -- claude
```

`argos-board --version` muestra la versión y el commit del binario instalado.

## Comportamiento del wrapper

- Propaga el código de salida del agente; si el agente muere por una señal, sale con `128 + N` como la shell
  (130 con Ctrl+C, 143 con `kill`).
- Si su entrada viene de un pipe o archivo y se acaba, el agente recibe EOF (como Ctrl+D).

## Limitaciones conocidas

- Escribir en el prompt (eco) cuenta como actividad: mientras escribes, la tarjeta dice *Trabajando*.
- Si se mata el wrapper con `SIGKILL` la terminal puede quedar en modo raw (no se puede interceptar);
  ejecuta `reset`. Con `SIGTERM`/`SIGHUP` se restaura correctamente.

## Desarrollo

```sh
cargo test                                # unitarios + integración (CLI falso en tests/fake_agent.sh)
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Estructura:

- `src/server/` — `serve`: axum, estado en memoria, WebSockets `/ws` (navegador) e `/ingest` (wrapper).
- `src/wrapper/` — `run`: PTY, modo raw, emulador `vt100`, detección por actividad, cliente de ingesta, dumps.
- `src/model.rs` — snapshot de agente y mensajes (contrato estable, ver spec §4).
- `web/` — página embebida en el binario. `data.js` (datos/WebSocket) está separado de `render.js` (DOM) y de
  `office.js` (la Oficina en canvas; sus sprites, dibujados como texto, están en `sprites.js`);
  `prefs.js` guarda las preferencias locales. `web/fonts/` incluye Montserrat (licencia OFL, `OFL.txt`) y
  `web/vendor/gridstack/` incluye gridstack.js 14.0.0 (MIT) para el lienzo.
