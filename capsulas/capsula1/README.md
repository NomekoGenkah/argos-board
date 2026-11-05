# Cápsula 1 — "La tarea"

Video de ~80 s (1920×1080, 30 fps) para la intervención *¿Amigo, herramienta o algoritmo?*
(Informática y Sociedad). Benja usa la IA para hacer toda la guía y resumir un libro que no existe;
al día siguiente queda en blanco en la prueba.

- **Video final:** [`capsula1_la_tarea.mp4`](capsula1_la_tarea.mp4)
- Todo se genera por código: ilustraciones con Pillow/numpy, audio sintetizado con numpy/scipy
  (sin muestras externas) y armado con ffmpeg. No hay voces todavía: los diálogos van como subtítulos.

## Requisitos

- Python 3.10+ con `pillow`, `numpy`, `scipy`:

```bash
pip install pillow numpy scipy
```

- `ffmpeg` compilado con libass (filtro `subtitles`).
- Fuentes: **Inter** e **Inter Display** (`.otf`), **JetBrains Mono** y **Noto Color Emoji**.
  Caveat (letra manuscrita) ya viene en `assets/fonts/`. Las demás se buscan por nombre de archivo
  en `assets/fonts/`, en las carpetas de `$CAPSULA_FONT_DIRS` y en las carpetas de fuentes del sistema.
  Si falta alguna, basta con copiar el archivo a `assets/fonts/`.

## Cómo se arma

```bash
python3 build.py
```

1. Renderiza cada escena por separado en `out/seg_<id>.mp4`: los cuadros se envían uno a uno a ffmpeg,
   así la memoria se mantiene baja (`--jobs N` controla cuántas escenas van en paralelo; por defecto 3).
2. Une los segmentos sin recodificar.
3. Sintetiza `out/audio.wav`, agrega el audio (normalizado a −16 LUFS) y quema `subs.srt`.

Resultado: `out/capsula1_la_tarea.mp4`.

Otros modos:

```bash
python3 build.py --only s3_copia s4_chat_libro   # re-renderiza solo esas escenas y vuelve a armar
```

```bash
python3 build.py --assemble                      # solo audio + subtítulos + unión (sin renderizar cuadros)
```

```bash
python3 build.py --still s6_prueba 7.5           # guarda un cuadro en out/still.png para revisar
```

Las imágenes grandes (escritorio de noche, de día, etc.) se guardan en `out/cache_*.png`.
Si cambias cómo se dibuja un fondo, borra el `cache_*.png` correspondiente.

## Qué editar

| Quiero cambiar… | Archivo |
|---|---|
| Textos del chat, líneas copiadas, dato final, tarjeta de cierre, duración de escenas | `plan.json` |
| Subtítulos (o quitarlos al grabar voces) | `subs.srt` |
| Momentos exactos (tecleo, escritura, golpes de lápiz) | `timeline.py` |
| Música y efectos | `audio.py` |
| Escritorio de noche, copia, prueba | `scene_desk.py` |
| Interfaz de chat del celular | `scene_chat.py` |
| Alerta, dato 17 %, tarjeta final | `scene_cards.py` |

## Escenas

| Tiempo | Escena | Id |
|---|---|---|
| 0:00–0:08 | Escritorio de noche, 23:47, se enciende el celular | `s1_noche` |
| 0:08–0:20 | Chat: "resuélveme toda la guía con desarrollo" | `s2_chat_guia` |
| 0:20–0:28 | Copia en cámara rápida (×16), celular con el chat real | `s3_copia` |
| 0:28–0:42 | Chat: resumen de *El faro de Coquimbo* (inventado) | `s4_chat_libro` |
| 0:42–0:48 | Alerta: "Ese libro no existe. La IA lo inventó." | `s5_alerta` |
| 0:48–1:02 | Al día siguiente: prueba casi en blanco | `s6_prueba` |
| 1:02–1:12 | Imagen congelada + dato: quienes dependieron de la IA para toda su práctica rindieron 17 % peor en la prueba sin IA (Bastani et al., PNAS 2025) | `s7_dato` |
| 1:12–1:20 | Tarjeta final "¿Amigo, herramienta o algoritmo?" | `s8_cierre` |

## Para agregar las voces grabadas

Pon los audios en `assets/voces/` y súmalos en `audio.py` (función `build`, con `mx.add(tiempo, señal)`)
en los tiempos de `subs.srt`. Después corre `python3 build.py --assemble`.
