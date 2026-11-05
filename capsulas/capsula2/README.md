# Cápsula 2 — "La noche"

Video de ~80 s (1920×1080, 30 fps) para la intervención *¿Amigo, herramienta o algoritmo?*
(Informática y Sociedad). Después de pelear con Tomás, Benja se encierra y le cuenta todo a la IA,
que le da la razón en todo y lo empuja a aislarse.

- **Video final:** [`capsula2_la_noche.mp4`](capsula2_la_noche.mp4)
- Mismo estilo que la cápsula 1: ilustración cenital, celular en primer plano y sin rostros.
  Las personas se ven desde arriba (cabeza y hombros) y, en el patio, por sus sombras largas de la tarde.
- Todo se genera por código: Pillow/numpy para la imagen, numpy/scipy para el audio
  (las "voces ininteligibles" de la discusión son sintéticas) y ffmpeg para el armado.
  Los diálogos con voz (mamá, Benja, hermana) van como subtítulos hasta que graben las voces.

## Requisitos y uso

Los mismos que en [`../capsula1/README.md`](../capsula1/README.md): Python 3.10+ con
`pillow numpy scipy`, ffmpeg con libass y las fuentes Inter / Inter Display, JetBrains Mono
y Noto Color Emoji (Caveat viene en `assets/fonts/`).

```bash
python3 build.py
```

```bash
python3 build.py --only s3_chat s4_notif
```

```bash
python3 build.py --assemble
```

```bash
python3 build.py --still s5_puerta 1.5
```

Las imágenes y mapas de luz grandes se guardan en `out/cache_*`. Si cambias cómo se dibuja un fondo,
borra el archivo de caché correspondiente.

## Qué editar

| Quiero cambiar… | Archivo |
|---|---|
| Mensajes del chat, notificación, dato, horas en pantalla, duración de escenas | `plan.json` |
| Subtítulos | `subs.srt` |
| Tiempos (tecleo, golpes, notificación, giros de cabeza) | `timeline.py` |
| Música y efectos | `audio.py` |
| Patio y sombras | `scene_patio.py`, `people.py` |
| Casa en planta, pieza, primer plano | `scene_casa.py` |
| Interfaz del chat y notificación | `scene_chat.py` |
| Dato "1 de cada 3" y tarjeta final | `scene_cards.py` |

## Escenas

| Tiempo | Escena | Id |
|---|---|---|
| 0:00–0:10 | Patio, 17:05: Benja y Tomás discuten (sombras); Tomás se va | `s1_patio` |
| 0:10–0:18 | Casa en planta, 18:10: "¿Benja? ¿Cómo te fue?" / "Bien." y portazo | `s2_casa` |
| 0:18–0:40 | Pieza a oscuras, 19:47: chat con la IA | `s3_chat` |
| 0:40–0:50 | Notificación de Tomás: "oye… ¿podemos hablar?"; la desliza sin abrirla | `s4_notif` |
| 0:50–0:58 | Benja sentado en la cama con el celular; golpes en la puerta: "Benja, ¿estás bien? Hay once." | `s5_puerta` |
| 0:58–1:10 | Primer plano iluminado por la pantalla, congelar + dato (Common Sense Media, 2025) | `s6_dato` |
| 1:10–1:20 | Tarjeta final "¿Amigo, herramienta o algoritmo?" | `s7_cierre` |

Notas del guion respetadas: el final queda abierto, no hay referencias a autolesiones ni llanto;
la tristeza se sugiere con la luz y el silencio.
