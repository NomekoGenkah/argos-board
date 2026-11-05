# Cápsula 3 — "El grupo"

Video de 75 s (1920×1080, 30 fps) para la intervención *¿Amigo, herramienta o algoritmo?*
(Informática y Sociedad). Un compañero sube al grupo del curso una imagen falsa hecha con IA
de Martina; Benja duda si reenviarla mientras ella se entera en el pasillo.

- **Video final:** [`capsula3_el_grupo.mp4`](capsula3_el_grupo.mp4)
- Mismo estilo que las cápsulas 1 y 2: ilustración cenital, celular en primer plano y sin rostros.
- No hay diálogo hablado: todo el texto está en pantalla, así que no lleva subtítulos (`subs.srt` vacío).

## Cuidados (según las notas del guion)

- La "imagen" del chat es **siempre un bloque gris completamente difuminado** (ruido suave muy
  desenfocado), con la etiqueta "imagen generada con IA" y un ícono de ojo tachado. No tiene ni cuerpo,
  ni cara, ni silueta: está generado así a propósito en `scene_grupo.py` (`blurred_block`).
- Martina solo aparece vista desde arriba, igual que el resto de los personajes. Su reacción se cuenta
  con el movimiento (se detiene, mira el celular, se va rápido), con un cierre de viñeta y con el sonido
  (el ambiente se apaga y queda solo la respiración).
- Nombres ficticios; ningún colegio real (el letrero dice solo "COLEGIO").
- El dato indica la fuente y que la encuesta es de EE.UU.

## Requisitos y uso

Los mismos que en [`../capsula1/README.md`](../capsula1/README.md).

```bash
python3 build.py
```

```bash
python3 build.py --only s4_pasillo
```

```bash
python3 build.py --still s3_reenviar 5
```

## Qué editar

| Quiero cambiar… | Archivo |
|---|---|
| Mensajes del grupo, nombres y colores, menú, pregunta, dato, duración de escenas | `plan.json` |
| Tiempos (llegada de mensajes, dedo, pasillo, congelado) | `timeline.py` |
| Música y efectos | `audio.py` |
| Calle y fondo desenfocado del colegio | `scene_calle.py` |
| Chat grupal, bloque difuminado, menú y dedo | `scene_grupo.py` |
| Pasillo | `scene_pasillo.py` |
| Personajes vistos desde arriba | `people.py` |
| Dato "1 de cada 8" y tarjeta final | `scene_cards.py` |

## Escenas

| Tiempo | Escena | Id |
|---|---|---|
| 0:00–0:08 | 07:42, Benja camina al colegio con audífonos; vibra el celular | `s1_camino` |
| 0:08–0:25 | Grupo "3°B 💀": ráfaga de mensajes y el bloque difuminado "imagen generada con IA" | `s2_grupo` |
| 0:25–0:35 | Menú del mensaje, dedo sobre "Reenviar"; al fondo, desenfocada, Martina entra al colegio; latido | `s3_reenviar` |
| 0:35–0:50 | Pasillo: dos compañeros miran un celular y se ríen al verla; ella revisa el suyo, todo se apaga y se aleja rápido | `s4_pasillo` |
| 0:50–1:00 | De vuelta al dedo sobre "Reenviar", congelar: "¿Reenvías?" | `s5_reenvias` |
| 1:00–1:07 | Dato: 1 de cada 8 jóvenes conoce a alguien afectado por un deepfake sexual (Thorn, 2025, EE.UU.) | `s6_dato` |
| 1:07–1:15 | Tarjeta final "¿Amigo, herramienta o algoritmo?" | `s7_cierre` |
