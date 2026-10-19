<div align="center">

# 👁 argos-board

**Un tablero web local que muestra qué hacen todos tus agentes de código en la terminal, y te avisa en cuanto uno te necesita.**

[English](README.md) · [Español](README.es.md) · [Privacidad](PRIVACY.md) · [Changelog](CHANGELOG.md)

![Argos Board con cuatro agentes: dos esperando al usuario, uno trabajando y otro inactivo](docs/img/demo.gif)

</div>

Si usas `claude`, `opencode`, `agy` o `copilot` en varias terminales, pasas el día cambiando de ventana para ver cuál
terminó, cuál se quedó esperando un permiso y cuál te hizo una pregunta. Argos Board los junta en una sola página, en
vivo, y marca los que esperan por ti.

- **Estado en vivo de cada agente**: trabajando, inactivo, esperando tu respuesta, esperando aprobación, error, terminado.
- **Una terminal fiel en cada tarjeta**, dibujada celda por celda con xterm.js; no un resumen de texto.
- **Responde desde la página**, o desde el celular: escribe, manda teclas, adjunta archivos, dicta por voz.
- **Avisos** cuando un agente empieza a esperar (contador en la pestaña, notificación, sonido opcional).
- **Barra de consumo** con cuánto llevas gastado de cada agente.
- **Local y privado**: sin cuentas, sin telemetría, sin llamadas de red propias. [Detalle](PRIVACY.md).
- Un solo binario con la página embebida. Funciona con cualquier comando, con detección calibrada para los cuatro de arriba.

## Instalar

Linux y WSL2 (x86_64 y aarch64). Descarga el binario de la
[página de releases](https://github.com/nomekogenkah/argos-board/releases/latest):

```sh
curl -L https://github.com/nomekogenkah/argos-board/releases/latest/download/argos-board-x86_64-unknown-linux-gnu.tar.gz | tar xz
sudo install argos-board-*/argos-board /usr/local/bin/
```

En ARM usa `aarch64-unknown-linux-gnu`. Cada release incluye un `SHA256SUMS`. O compílalo con Rust (estable):

```sh
cargo install --git https://github.com/nomekogenkah/argos-board
```

> macOS y Windows nativo todavía no están soportados. En Windows, úsalo dentro de WSL2 y abre
> `http://localhost:8787` desde el navegador de Windows.

## Usar

```sh
argos-board serve                          # una vez; imprime el enlace que debes abrir (http://localhost:8787/#k=…)
argos-board run -- claude                  # uno por terminal, envolviendo al agente
argos-board run --name backend -- opencode
```

El wrapper es transparente: el agente se usa igual que sin él, y sigue funcionando aunque el servidor no esté
corriendo. Abre el enlace que imprime `serve`: con él la página también puede escribir en los agentes; sin el token
es de solo lectura. También puedes lanzar agentes desde la página (**Nuevo agente**).

## La página

| Tablero | Oficina |
|---|---|
| ![Tablero en estilo oscuro](docs/img/board-dark.png) | ![La vista Oficina en pixel-art](docs/img/office.png) |

- **Tablero** con tres disposiciones (lienzo libre, cuadrícula, foco), ocho estilos (cuatro looks, claro y oscuro),
  presets, y español / inglés.
- **Oficina**: lo mismo en un plano de pixel-art. El lugar donde está cada agente dice su estado: en la fila frente a
  tu escritorio si te necesita, en su escritorio si trabaja, en la cocina si está inactivo.
- **Celular**: empareja tu teléfono con un código de un solo uso (`argos-board pair`).
- **Accesible**: sin fallos de axe-core (WCAG 2.1 AA) en todos los estilos, teclado, movimiento reducido.

## Documentación

- [Guía de referencia](docs/guide.es.md): todas las funciones, perfiles de detección, calibración, acceso desde otros
  dispositivos, seguridad, variables de entorno y comportamiento del wrapper.
- [Especificación](docs/argos-board-spec.md), [política de privacidad](PRIVACY.md) y [changelog](CHANGELOG.md).

## Desarrollo

```sh
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
node --test tests/web/*.test.mjs     # lógica de la página que no necesita navegador
```

Los releases salen al subir un tag `vX.Y.Z`; ver [`.github/workflows/release.yml`](.github/workflows/release.yml).

## Licencia

[MIT](LICENSE). Las librerías incluidas (gridstack.js, xterm.js) y las fuentes (Montserrat, JetBrains Mono, OFL)
conservan su licencia, junto a sus archivos.
