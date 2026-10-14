# Política de privacidad

[English](PRIVACY.en.md)

Argos Board es un programa que corre en tu propia máquina. No tiene cuentas, no tiene un servidor propio y no
recoge telemetría, estadísticas de uso ni informes de fallos. Esta página dice exactamente qué guarda, qué envía y
cómo borrarlo. Si algo de lo que ves en el programa no coincide con ella, es un error: abre un *issue*.

## Qué corre y dónde

- `argos-board serve` es un servidor web que escucha en `127.0.0.1` y, salvo que uses `--local-only` o `--bind`, en
  las redes privadas de la máquina (LAN, WireGuard, Tailscale) para que puedas abrir el tablero desde el celular.
  Desde la red no se ve nada sin emparejar el dispositivo con un código de un solo uso.
- `argos-board run` envuelve a un agente en un terminal y le cuenta al servidor lo que se ve en su pantalla.
- La página que abres en el navegador viene dentro del propio programa: no carga fuentes, scripts ni imágenes de
  otros sitios.

## Qué guarda en tu máquina

| Dónde | Qué | Por qué |
|---|---|---|
| `~/.config/argos-board/token` y `control-token` | Dos secretos aleatorios (permisos `0600`) | Que solo tus wrappers manden datos y solo tu navegador escriba en los agentes |
| `~/.config/argos-board/devices.json` | Por cada dispositivo emparejado: un id, un nombre corto (p. ej. «Android · Chrome»), su token y las fechas de creación y último uso | Reconocer tu celular. Un dispositivo que no se usa en 30 días deja de valer; `argos-board revoke` lo quita antes |
| `~/.config/argos-board/voice/` y `usage-probe/` | Carpetas vacías de trabajo | La del dictado por voz y la desde donde se consulta el consumo, para no ensuciar tus proyectos |
| `<proyecto>/.argos/uploads/` | Los archivos que adjuntas desde la página, y un `.gitignore` que los excluye de git | Que el agente pueda leerlos |
| La carpeta que indiques con `--dump-screens` | Pantallas de los agentes | Solo si lo pides, para calibrar la detección |
| El archivo de `ARGOS_BOARD_LOG` | El registro del wrapper (sin lo que escribes ni lo que se ve) | Solo si lo pides, para depurar |

**La salida de los agentes no se escribe a disco.** Vive en la memoria del servidor mientras la tarjeta está a la
vista y se borra a los 10 minutos de que el agente termina. Lo que escribes en la página tampoco se guarda en
ningún registro.

## Qué guarda tu navegador

Solo en tu navegador (`localStorage`, sin cookies), y nunca sale de él:

- Preferencias: estilo, tema, disposición, densidad, esquinas, presets, idioma, movimiento, terminal, sonido,
  idioma del dictado, vista (Tablero u Oficina), consumo visible, posición y tamaño de cada tarjeta, escritorio de
  cada agente en la Oficina y qué tarjetas quitaste.
- Los permisos de acceso: el token del enlace de `serve` (si lo abriste) y el token de este dispositivo (si lo
  emparejaste).
- Un aviso de «ya avisé de esto» por pestaña (`sessionStorage`), para no repetir notificaciones.

Para borrarlo todo: «Borrar datos del sitio» en la configuración del navegador.

## Qué se envía, y a quién

**A Argos Board: nada.** No existe un servidor de Argos Board al que enviar algo. El programa mismo no hace llamadas
de red salientes. Lo siguiente lo hacen otras piezas, solo cuando tú usas la función:

- **Consumo de cada agente.** Con la opción activada (Ajustes), el servidor ejecuta `claude -p "/usage"`,
  `agy -p "/usage"` y `opencode stats` para los agentes que tengas instalados, desde una carpeta neutra, como mucho
  cada 5 minutos y solo mientras hay una página abierta. Esos programas consultan a sus propios proveedores
  (Anthropic, Google) con tus credenciales, igual que si los ejecutaras tú; Argos Board solo lee la respuesta.
  Se desactiva en Ajustes o con `ARGOS_BOARD_NO_USAGE=1`.
- **Los agentes que lanzas o envuelves** (Claude Code, OpenCode, Antigravity, Copilot) hablan con sus proveedores
  bajo los términos de cada uno. Argos Board no lee ni reenvía ese tráfico.
- **Dictado por voz.** Con el motor del navegador (Chrome, Edge), el audio lo procesa el servicio de voz del
  propio navegador. Con el motor del servidor, un `agy` oculto manda el audio al servicio de voz de Google, igual
  que su comando `/voice`. En ambos casos solo mientras dictas y sin guardar el audio. Se desactiva con
  `ARGOS_BOARD_NO_VOICE=1`.
- **Notificaciones.** Las muestra tu navegador; el texto no sale de tu máquina.
- **Enlaces.** «Leer la política completa» en Ajustes abre esta página en GitHub si la pulsas.

## Secretos

Antes de salir del wrapper, las líneas de pantalla pasan por una redacción por patrones (claves `sk-…`,
`Bearer …`, variables `*_KEY=`, `*_TOKEN=`, `*_SECRET=`, `*_PASSWORD=`). Es un filtro básico y no puede ser perfecto:
si trabajas con un secreto con otra forma, puede verse en la tarjeta. No se escribe a disco ni sale de tu máquina.

## Acceso por la red

Desde el celular, el tráfico va por HTTP sin cifrar. Úsalo en redes en las que confíes o a través de un túnel
cifrado (WireGuard, Tailscale), y no pongas un proxy inverso delante (ver el README). Cualquier dispositivo
emparejado tiene acceso total: ver, escribir en los agentes y lanzarlos.

## Tus controles

- `argos-board devices` lista los dispositivos emparejados y `argos-board revoke <id>` (o `--all`) los revoca.
- Borra `~/.config/argos-board/control-token` y reinicia `serve` para quitarle el permiso de escritura a todos los
  navegadores.
- Borra `~/.config/argos-board/` para quitar todo lo que el programa guardó fuera de tus proyectos, y las carpetas
  `.argos/` de tus proyectos para quitar los archivos adjuntados.
- Desinstala con `cargo uninstall argos-board`.

## Cambios

Los cambios a esta política se ven en el historial de git de este archivo.
