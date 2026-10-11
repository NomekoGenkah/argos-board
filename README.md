# argos-board

Tablero web local para ver en tiempo real el estado de varios agentes de código CLI
(`claude`, `opencode`, `agy`, o cualquier otro comando) que corren en terminales distintas.
Solo observa: no lanza, detiene ni controla agentes.

Especificación completa: [`docs/argos-board-spec.md`](docs/argos-board-spec.md).

> **Estado: MVP.** Hoy detecta `working` / `idle` por actividad de salida, además de `exited` y
> `disconnected`. La detección de `waiting_approval` / `error` necesita calibrarse con sesiones reales
> (ver `--dump-screens` más abajo) y llegará en el hito M3.

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

### Calibrar la detección de estados

```sh
argos-board run --dump-screens ~/argos-dumps/claude -- claude
```

Guarda la pantalla completa (texto) en cada cambio de estado (`working` → `idle`, etc.) y al terminar. Úsalo
para capturar cómo se ve de verdad el prompt de aprobación de cada agente; con esos textos se escribirán los
patrones de `waiting_approval`. **Los dumps pueden contener secretos de la sesión** (no se redactan): no los
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

## Limitaciones conocidas del MVP

- `working`/`idle` se basa solo en actividad de salida: escribir en el prompt (eco) cuenta como actividad.
- Si se mata el wrapper con `SIGKILL` la terminal puede quedar en modo raw (no se puede interceptar);
  ejecuta `reset`. Con `SIGTERM`/`SIGHUP` se restaura correctamente.
- Si el hijo muere por una señal, el código de salida propagado es `1`.

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
- `web/` — página embebida en el binario. `data.js` (datos/WebSocket) está separado de `render.js` (DOM).
