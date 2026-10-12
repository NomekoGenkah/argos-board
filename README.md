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
argos-board serve            # http://localhost:8787  (--port para otro puerto); muestra también la dirección para el celular

# 2. Un agente por terminal, envuelto por el wrapper
argos-board run -- claude
argos-board run --name backend -- opencode
argos-board run --project ~/proyectos/x -- agy
```

Abre en el navegador el enlace que imprime `serve` (`http://localhost:8787/#k=…`): con él la página puede
**escribir en los agentes**; sin el token (`http://localhost:8787` a secas) funciona igual pero en solo lectura.
El wrapper es transparente: el agente se usa igual que sin él
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
- **Escribir en un agente**: cada tarjeta tiene una caja de texto. Enter envía (el texto y luego Enter);
  Mayús+Enter agrega una línea; con la caja vacía, ↑, ↓ y Esc van directo al agente (para moverse en sus
  menús). Debajo, teclas rápidas: ↑ ↓ Enter Esc Tab y Ctrl+C. Probado con `claude`, `opencode` y `agy`
  (responder sus preguntas, escribir prompts, texto de varias líneas). La cabecera dice si la página tiene
  permiso: *Escritura activa* o *Solo lectura* (al hacer clic, explica cómo conseguirlo).
- **Dictado por voz**: junto a *Enviar*, cada consola tiene un botón de micrófono. Púlsalo, habla (lo que dices
  aparece en la caja mientras hablas) y púlsalo de nuevo para terminar; revisas y envías como cualquier texto.
  Como el texto entra por la consola, sirve igual para `claude`, `opencode` y `agy`, y enviar con el dictado
  activo lo cierra y manda lo dicho. Hay dos motores y la página usa el primero que tenga:
  1. **El de `argos-board`, con `agy`** (si `agy` está instalado y con la sesión iniciada): el servidor lleva un
     `agy` oculto que oye el micrófono de la página y transcribe con el mismo servicio de voz de su `/voice`.
     Funciona en **cualquier navegador con micrófono, Firefox incluido**. La primera vez tarda unos 10 s en
     calentar (se precalienta al abrir la página); se cierra solo tras 20 min sin dictar. Un dictado a la vez
     (también `agy` permite un solo flujo de voz por cuenta). El idioma lo decide `agy`. Para desactivarlo:
     `ARGOS_BOARD_NO_VOICE=1`.
  2. **El del navegador** (Chrome o Edge; el audio lo procesa su propio servicio): si no hay `agy`. El botón
     *Voz: es-CL* de la cabecera cambia su idioma.

  En ambos el navegador solo da acceso al micrófono con la página en `localhost` o por HTTPS: por `http://<ip>`
  desde otro dispositivo el botón no aparece (en el celular, usa el micrófono del teclado). El audio no se guarda;
  con el motor del servidor sale hacia el servicio de voz de Google por `agy`, igual que su `/voice`.
- **Nuevo agente** (cabecera, con permiso de escritura): eliges el tipo (solo los que están instalados), la
  carpeta (recientes o navegando) y, si quieres, un nombre; *Lanzar aquí* y aparece su tarjeta. Si tienes tmux,
  corre en una sesión propia y la tarjeta muestra cómo tomarlo desde una terminal
  (`tmux -L argos-board attach -t argos-claude-api`); si no, solo existe en la página. *Detener* (con
  confirmación) lo cierra. La primera vez en una carpeta, Claude pregunta si confías en ella: responde desde la
  consola de la tarjeta.
- Modo claro por defecto; el selector *Claro / Oscuro* de la cabecera cambia el tema (se recuerda en ese navegador).
- **Oficina** (botón *Tablero / Oficina* de la cabecera): la misma información en pixel-art, en un solo plano.
  Cada agente es una mascota (Claude, un bicho naranja de bloque; Antigravity, un domo azul que flota con
  antena; OpenCode, un robot blanco con cara de terminal) y **el lugar donde está dice su estado**:
  - **Te esperan**: los que te hicieron una pregunta (cartel **?**, saltan) o piden permiso (papel para firmar,
    globo ✋) hacen fila frente a tu escritorio, por orden de llegada; el cartel de la zona muestra cuántos son.
  - **Oficina**: en su escritorio, trabajando (teclean; el monitor es una miniatura de su pantalla real), con
    error (ojos en X, monitor rojo con humo) o desconectado (gris, monitor con estática).
  - **Cocina**: los inactivos, sentados con su taza de café.
  - **Salida**: los que terminaron, con el maletín junto a la puerta.

  Cada agente conserva su escritorio aunque esté en otro lugar (se ve con su nombre y un salvapantallas), y
  camina de un lugar a otro cuando cambia de estado. El ojo de Argos en la pared mira al primero de la fila;
  la ventana, el calendario y el reloj siguen la fecha y la hora reales. Al hacer clic en una mascota (o con
  Tab y Enter) se abre su panel: su pantalla en vivo y la consola para escribirle (*Ver en el tablero* lleva a
  su tarjeta). *Reordenar* acomoda los escritorios por estado. La escala
  elige los píxeles más grandes con los que la oficina entra en la pantalla. Con `prefers-reduced-motion`
  no hay animaciones. La vista elegida se recuerda en ese navegador.
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

En el mismo archivo, `allow_input = false` (al principio, fuera de las tablas) hace que ningún agente acepte
entrada desde la página. Para lanzar agentes desde la página:

```toml
launch_roots = ["~/repositorios", "/mnt/c/proyectos"]   # dónde se puede lanzar (por defecto, tu home)

[launch.opencode]                                       # argumentos fijos por tipo (nunca desde la web)
args = ["-m", "deepseek/deepseek-flash"]
```

Los agentes lanzados heredan el entorno de `argos-board serve` (PATH, credenciales): arráncalo desde tu shell
de siempre.

Si el archivo tiene un error, `argos-board run` lo avisa al arrancar y usa los valores por defecto.

### Calibrar la detección de estados

```sh
argos-board run --dump-screens ~/argos-dumps/claude -- claude
```

Guarda la pantalla completa (texto) en cada cambio de estado (`working` → `idle`, etc.) y al terminar. Úsalo
para capturar cómo se ve de verdad una pantalla nueva (otro agente, una versión nueva, un error) y escribir sus
patrones. **Los dumps pueden contener secretos de la sesión** (no se redactan): no los
subas al repo sin revisarlos.

## Acceso desde otros dispositivos (celular, otra notebook)

`argos-board serve` ya escucha, además de en esta máquina, en las **redes privadas** a las que está conectada
(LAN, WireGuard…), y al arrancar dice desde dónde conectarse y, la primera vez, da un código:

```
Desde el celular u otro dispositivo de la red, abre:
    http://192.168.1.134:8787/   (eth0)
    http://10.8.0.1:8787/        (wg0)

Código de emparejamiento:  K7QM-2XPD
    (un solo uso, caduca en 5 minutos; ingrésalo en esa página)
```

En el celular abre esa dirección: la página pide el código. Al canjearlo, ese dispositivo recibe su propio token
(se guarda en su navegador) y queda con **acceso total**: ver, escribir en los agentes y lanzarlos. Un solo nivel de
acceso, a propósito. El código sirve una sola vez, caduca a los 5 minutos y se anula tras 5 intentos fallidos.

```sh
argos-board pair                # otro código (p. ej. por SSH en un servidor sin pantalla, o para sumar otro dispositivo)
argos-board devices             # lista los dispositivos emparejados
argos-board revoke <id|nombre>  # revoca uno (o --all); sus sesiones abiertas se cortan en unos segundos
```

Con dispositivos ya emparejados, `serve` no genera un código en cada arranque (solo recuerda `argos-board pair`).
Un dispositivo que no se usa durante 30 días deja de ser válido.

Para limitarlo:

```sh
argos-board serve --local-only        # solo esta máquina, sin ofrecerlo a la red
argos-board serve --bind 10.8.0.1     # solo esa(s) IP(s) (p. ej. solo WireGuard, no el Wi-Fi); se puede repetir
```

Notas:

- Solo se ofrece en IPs **privadas** (10.x, 172.16-31.x, 192.168.x, 100.64.x, enlace local); `--bind` rechaza
  `0.0.0.0` y las IPs públicas. Se omiten las interfaces de contenedores (docker, virbr…).
- Desde la red no se ve nada sin emparejar (ni siquiera la lectura), y la ingesta de wrappers sigue siendo solo local.
- **No pongas un proxy inverso delante**: el servidor distingue «esta máquina» por la dirección de origen de la
  conexión, y un proxy local haría que todo parezca local.
- WSL2: la dirección que se muestra es la de WSL. Con `networkingMode=mirrored` es la de tu red y llega directo
  (puede hacer falta abrir el puerto en el firewall de Windows); en modo NAT no se llega desde fuera sin un
  reenvío de puertos.
- Sin HTTPS (por ahora): sobre HTTP el navegador no ofrece las notificaciones (`Notification`) ni instala la PWA con
  service worker; con WireGuard el tráfico ya va cifrado. El sonido y el contador de la pestaña sí funcionan.

## Tests de la página

La lógica del dictado por voz (el motor, el procesador de audio del micrófono) tiene pruebas de Node, sin
navegador: `node --test tests/web/*.test.mjs`. El CI de GitHub solo corre las de Rust.

## Seguridad

- El servidor escucha en `127.0.0.1` y en las IPs privadas de esta máquina (`--local-only` o `--bind` lo limitan; ver
  arriba); se
  valida `Host` y `Origin` (protección contra DNS rebinding y páginas externas) y que cada conexión venga de la
  propia máquina o de una red privada.
- La ingesta exige un token que `serve` genera al iniciar en `~/.config/argos-board/token` (permisos `0600`).
- **Escribir en los agentes** exige otro token, `~/.config/argos-board/control-token` (`0600`), que llega a la
  página solo por el enlace que imprime `serve` y **solo vale desde la propia máquina**; desde la red se usa el
  token de un dispositivo emparejado (`devices.json`, `0600`, en texto plano como los demás tokens). Se conserva entre reinicios; para renovarlo (y quitarle el
  permiso a todos los navegadores) borra el archivo y reinicia `serve`. Cada agente puede negarse:
  `argos-board run --no-input -- claude`, o para todos, `allow_input = false` en `config.toml`. La página
  nunca manda bytes crudos (texto sin caracteres de control, o teclas de una lista cerrada) y lo que escribes
  no se guarda en ningún log.
- **Lanzar agentes** usa los mismos tokens. Solo se lanzan los tipos conocidos (`claude`, `opencode`, `agy`) con
  los argumentos de `config.toml`, nunca un comando que venga del navegador, y solo en carpetas dentro de
  `launch_roots`. *Detener* solo toca sesiones de tmux `argos-…` o procesos que lanzó ese mismo `serve`.
- Nada se escribe a disco salvo el token (y los dumps si los pides). Las últimas líneas se redactan
  (`sk-...`, `Bearer ...`, `*_KEY=`, `*_TOKEN=`, `*_SECRET=`, `*_PASSWORD=`) antes de salir del wrapper.
- Sin llamadas de red salientes.

## WSL2

- Verificado: desde Windows, `http://localhost:8787` llega al servidor en WSL2 gracias al reenvío de localhost
  (activo por defecto). Si en tu equipo no funciona, revisa `localhostForwarding=true` (o
  `networkingMode=mirrored`) en `%UserProfile%\.wslconfig` y reinicia WSL con `wsl --shutdown`.
  No abras el servidor a `0.0.0.0` (`--bind` no lo permite).
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
