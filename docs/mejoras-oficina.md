# Mejoras del modo Oficina — checklist

Lista de mejoras de **animación, calidad visual, rendimiento, accesibilidad y mantenibilidad** para la vista Oficina (`web/office.js`, `web/sprites.js`, `web/app.css`).

Origen: revisión holística del modo Oficina (ver hilos 2026-10). Contexto de frecuencia: el wrapper envía `Screen` cada 250 ms si algo cambió (`src/wrapper/mod.rs:32`); `data.js` emite un evento por mensaje (`web/data.js:106-170`); `app.js:249` suscribe `office.render` **siempre**, así que corre hasta ~4 veces/s por agente aunque la Oficina esté oculta.

Severidad: **Alta / Media / Baja**. Esfuerzo: **Bajo / Medio / Alto**.

---

## Rendimiento

- [x] **1.1 — No renderizar la Oficina si está oculta** (Alta · Bajo) — `office.js:1315-1352`
  ✅ `render()` guarda `agents` y marca `dirty` si `!active`; `setActive(true)` recalcula. `rebuild()` (datos/DOM) quedó separado de `resize()`/`draw()`.
  `render()` no retornaba temprano si `!active`: hacía `assignSeats` (`1318`), `prefs.setSeats` con dos `JSON.stringify` (`prefs.js:60-65`), `groupByZone` y re-`append` de todos los botones (`1345`), en cada mensaje WS.

- [x] **1.2 — Cachear lo estático del fondo por tema** (Alta · Medio) — `office.js:568-599`
  ✅ Nueva capa `bg` (`drawStatic`): pisos, tabiques, pared/panel/LED, plantas, calendario, esfera del reloj, base del emblema. Se repinta solo si cambia geometría, tema o día; cada frame solo se copian los `drawImage` y se animan agujas, pupila/parpadeo y ventana. Medido con `tests/web/office.test.mjs`: el montaje cuesta ~15× un frame normal.
  `draw()` repintaba ~8/s pared, reloj (5 discos × ~120 rects + 12 marcas), emblema, calendario y ventana con ciudad/estrellas, aunque casi nada cambie.

- [x] **1.3 — Reducir `FRAME_MS` para suavizar el movimiento** (Media · Bajo) — `office.js:38, 467, 601-626`
  ✅ `FRAME_MS` 120 → 80 (~12 fps). Las animaciones ligadas a `t` (paso, parpadeo, vapor, baliza) se aceleran proporcionalmente; si alguna queda nerviosa, pasarlas a tiempo real (ver 2.6).

- [x] **1.4 — Cachear `stripAnsi` + `miniLine` por línea** (Media · Bajo) — `office.js:1239-1249`, `ansi.js:4-10`
  ✅ `lineInfo(raw)` memoiza por línea cruda (`text`, bits ya rasterizados, si está seleccionada y su largo) en un `Map` con tope de 1000 entradas.

- [x] **1.5 — Precalcular paletas constantes** (Baja-media · Bajo) — `office.js:483-487, 1266-1270`
  ✅ `drawBubble` reutiliza la paleta por color (`bubblePals`); el resto de paletas constantes ya se creaban una vez al construir el renderizador.

- [x] **1.6 — Cachear `new Date()` / cielo / reloj** (Baja · Bajo) — `office.js:753, 829, 867`
  ✅ Una sola `new Date()` por frame en `draw()`, compartida por ventana (cielo) y agujas; el calendario ahora es estático y la esfera del reloj se cachea.

- [x] **1.7 — No parsear fechas dentro del comparador** (Baja · Bajo) — `office.js:175`
  ✅ `groupByZone` parsea `state_since` una vez por agente y ordena con el timestamp precalculado.

- [x] **1.8 — Aligerar `tickPlates`** (Baja · Bajo) — `office.js:450-460`
  ✅ La referencia a `.plate-text` se cachea en el botón (`b.plateText`) al crearlo, en vez de `querySelector` cada segundo.

- [x] **1.9 — No re-`append`ear todos los botones si el orden no cambió** (Baja · Medio) — `office.js:1345`
  ✅ Resuelto del todo en 3.1: no se reinsertan botones al cambiar el orden (el de prioridad se gestiona con `tabindex`); solo se mueve un botón cuando cambia de zona (3.2).

- [x] **1.10 — Debounce del `ResizeObserver`** (Baja · Bajo) — `office.js:1306`
  ✅ El observer colapsa la ráfaga de redimensionados a un `requestAnimationFrame`.

- [x] **1.11 — Podar caches de paletas/sprites al irse agentes** (Baja · Bajo) — `office.js:472, 1160`; `sprites.js:508-524`
  ✅ Revisado: `palettes` se indexa por `kind|gray` y `propPalettes`/`bubblePals` por color de un tipo de agente, así que están **acotadas** (~5 tipos); no crecen sin freno. `lineCache` (1.4) lleva tope de 1000. No requiere acción.

---

## Animación y calidad visual

- [x] **2.1 — Voltear el sprite según la dirección** (Media · Bajo) — `office.js:587-597`
  ✅ `drawMascot` acepta `flip`: espeja patas, brazos (cada uno pasa al otro lado), cuerpo y ojos. Los caminantes lo activan cuando `tg.mx < p.x` (`flip: Boolean(tg) && tg.mx < p.x`).
  No se usaba `dx` para el `flip`; todos caminaban mirando a la derecha. `S.draw` ya soporta `flip` (`sprites.js:543-550`).

- [ ] **2.2 — Waypoints y separación al caminar** (Media · Alto) — `office.js:601-626`
  Interpolación recta: atraviesan tabiques (que tienen paso dibujado, `671-693`), escritorios y se solapan entre sí. Añadir puntos de paso por los huecos y una separación mínima.

- [x] **2.3 — "Respiración" en reposo** (Media · Bajo) — `office.js:1110-1119, 1064-1082`
  ✅ Helper `breathe(a, t)`: bob de 1 px cada ~0.64 s, desincronizado con `S.hash(a.name)`, desactivado con `prefers-reduced-motion`. Se aplica a las mascotas quietas (escritorio, cocina sin sorbo, cola y salida) junto con lo que sostienen (taza, papel, maletín).

- [ ] **2.4 — Easing y velocidad por agente** (Baja · Bajo) — `office.js:620`
  Velocidad constante → arranque/parada bruscos. Suavizado corto + variación por agente.

- [ ] **2.5 — Señalizar mejor los cambios de estado** (Baja · Medio)
  Los que reconectan tras una caída no entran por la puerta (solo `agent_added` con snapshot previo, `office.js:1336-1340`). Pulsos breves al pasar a `error`/`waiting_*` (más allá de bubble/spotlight).

- [ ] **2.6 — Pulido de detalles** (Baja · Bajo)
  - Segundero con `Math.round` salta (`877-882`) → suavizar.
  - Vapor (`STEAM`) alterna a 120 ms, quizá muy rápido (`1039, 1080`).
  - La caja clickeable del botón salta de tamaño al llegar al destino (`placeButtons`, `407-419`) → animar o mantener estable.

---

## Accesibilidad

- [x] **3.1 — No reescribir el orden del DOM en cada render** (Media · Medio) — `office.js:1345`
  ✅ Ya no se reinsertan botones en cada render: la prioridad (te esperan → oficina → cocina → salida) la gobierna un **tabindex móvil** (`deskOrder`/`tabStop`, un solo escritorio `tabindex=0`). Las flechas/Home/End recorren el grupo sin mover nodos (`nextDesk`, en `office-pure.js`), así no se pierde el foco ni salta el orden de tabulación al cambiar estados. (El único movimiento de nodos —cambiar de grupo de zona— es de 3.2 y solo ocurre cuando el agente cambia de zona.)

- [x] **3.2 — Estructura semántica por zona** (Baja · Bajo) — `app.css:368`
  ✅ `desks` deja de ser un contenedor plano: cada zona es un `role="group"` con `aria-label` (`zoneGroups`: cola, oficina, cocina, salida). Un botón vive en el grupo de su zona y **solo se mueve cuando el agente cambia de zona** (si tenía el foco, se le devuelve al moverlo). Los grupos son cajas estáticas sin caja propia en el flujo, así que las posiciones absolutas de los botones no cambian.

- [x] **3.3 — No recrear `title` cada segundo** (Baja · Bajo) — `office.js:458`
  ✅ `tickPlates()` ya solo actualiza el texto de la placa (que sí cambia de segundo en segundo). El `title` se calcula **al pasar el ratón** (`pointerenter` → `tip()`), con su duración al día, así no se reescribe el atributo 1 vez/s ni parpadea el tooltip. Con teclado manda el `aria-label` (ya existente).

---

## Mantenibilidad y otras

- [x] **4.1 — Partir `office.js` y nombrar constantes** (Media · Medio)
  ✅ La **geometría** se fue a `web/office-geometry.js` (puro, sin DOM): tamaños base, `sceneLayout`/`bestLayout`, `podOrigin`, `door`, `kitchenLeft`, `computeTargets` y las constantes de sitio (`SPOT`, `WALK_INSET`, `TAG_INSET`). `office.js` pasa de ~1457 a 1351 líneas y se queda con el dibujo, el DOM y la orquestación; solo conserva un `computeLayout()` fino que lee el DOM y delega. De paso se nombraron los offsets que estaban repartidos: `COMPACT_PX`, `MIN_VIEW_H`, `BOTTOM_GAP`, y dentro de la geometría `WIDE_VW`, `RIGHT_FRAC`, `QUEUE_MIN_H`, `SLOT_GAP`, `DOOR_INSET`, etc. Nuevo `tests/web/office-geometry.test.mjs` (8 pruebas). La separación de `office-scene.js` (dibujo) queda como opcional no hecha: arrastraría ~12 dependencias del cierre y más riesgo que valor.

- [x] **4.2 — Tests de las funciones puras** (Media · Bajo) — `tests/web/`
  ✅ La lógica pura se movió a `web/office-pure.js` (sin DOM): `ZONE_OF`, `pickScale`, `assignSeats`, `miniLine`, `groupByZone`; `office.js` los importa y reexporta. Nuevo `tests/web/office-pure.test.mjs` (15 pruebas: escalas, reparto de escritorios con colisiones/huecos, miniatura de líneas y agrupación/orden por zona). Además sigue `tests/web/office.test.mjs` como prueba de humo del renderizador.
  `computeLayout`/`layoutAt` siguen dentro del renderizador porque usan `window`/`root`; separarlos queda como parte de 4.1.

- [x] **4.3 — Mover helpers compartidos a un módulo neutral** (Baja · Bajo) — `office.js:11`
  ✅ Nuevo `web/agents.js` (sin DOM) con `LABELS`, `formatDuration`, `sortAgents` y reexport de `KINDS`; `render.js` los importa de ahí y `dialog.js`/`launcher.js` ya no pasan por render para `LABELS`/`KINDS`. `office.js` dejó de importar `render.js`, así que importarlo **ya no arrastra** `term.js`/`console.js`/`launcher.js` (verificado: `import('./web/office.js')` sin DOM). De paso desaparece el ciclo `render → launcher → render`.

- [x] **4.4 — Orden de zonas explícito al dibujar señales** (Baja · Bajo) — `office.js:580`
  ✅ `ZONE_ORDER` (en `office-pure.js`) fija el orden canónico: `[queue, office, kitchen, exit]`. Lo usan el dibujo de los carteles, la apilación de zonas en el modo estrecho, los grupos semánticos, el recorrido con flechas (`deskOrder`) y las particiones. Ya no depende del orden de inserción de `layout.zones`.

---

## Priorización sugerida

| # | Mejora | Eje | Severidad | Esfuerzo |
|---|--------|-----|-----------|----------|
| 1.1 | No renderizar la Oficina si está oculta | Rendimiento | Alta | Bajo |
| 1.2 | Cachear lo estático (reloj/emblema/ventana) | Rendimiento | Alta | Medio |
| 2.1 | Voltear sprite según dirección | Animación | Media | Bajo |
| 2.3 | Respiración en reposo | Animación | Media | Bajo |
| 1.4 | Cachear `stripAnsi`/`miniLine` | Rendimiento | Media | Bajo |
| 4.2 | Tests de funciones puras | Calidad | Media | Bajo |
| 2.2 | Waypoints y separación al caminar | Animación | Media | Alto |
| 3.1 | No reordenar el DOM (CSS `order`) | A11y/Rend. | Media | Medio |
| 1.3 | Bajar `FRAME_MS` (tras 1.2) | Animación | Media | Bajo |
| 4.1 | Partir `office.js` y nombrar constantes | Calidad | Media | Medio |

**Si hay que elegir tres:** 1.1 + 1.2 + 4.2 (mayor ganancia con poco riesgo), y como "alegría visual" barata, 2.1 + 2.3.
