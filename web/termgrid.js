// Datos de la terminal sin tocar el DOM: de la pantalla de un agente a lo que se escribe en
// xterm.js, y cuánto debe medir la letra para que la terminal entre en su caja.

import { stripAnsi } from "./ansi.js";

/** Ancho de una celda respecto al tamaño de la letra (JetBrains Mono). */
export const CELL_RATIO = 0.6;
/** Interlineado que se le pide a xterm: se multiplica por la altura natural de la letra. */
export const LINE_HEIGHT = 1;
/** Alto de una fila respecto al tamaño de la letra (JetBrains Mono mide 1,32 em de arriba abajo). */
export const ROW_RATIO = 1.32 * LINE_HEIGHT;
/** Por debajo de este tamaño la terminal ya no se lee: la caja hace scroll en vez de achicarla más. */
export const MIN_FONT = 5;
export const MAX_FONT = 18;
/** Con la terminal entera por debajo de esto no se lee: `auto` pasa a ajustar al ancho. */
export const READABLE_FONT = 8;
/** Lo más chica que `auto` deja la letra al ajustar al ancho (si no entra, hay scroll horizontal). */
export const FLOOR_FONT = 7;
/** En un celular se lee peor: el piso sube. */
export const FLOOR_FONT_PHONE = 8.5;
/** Letra mínima con la que se dimensiona una tarjeta nueva. */
export const TARGET_FONT = 8;

const SEAL = "\x1b[0m";
const FALLBACK_MAX_COLS = 240;
const FALLBACK_MAX_ROWS = 40;

/**
 * La rejilla de un agente: la exacta que mandó el wrapper o, con un wrapper anterior,
 * una aproximada hecha con sus líneas (el ancho de la más larga).
 */
export function gridOf(agent) {
  if (agent.grid) return agent.grid;
  const all = agent.last_lines ?? [];
  const cols = Math.min(FALLBACK_MAX_COLS, Math.max(40, ...all.map((l) => stripAnsi(l).length)));
  const rows = Math.min(Math.max(all.length, 1), FALLBACK_MAX_ROWS);
  return {
    cols,
    rows,
    alt: false,
    cursor: null,
    history: all.slice(0, Math.max(0, all.length - rows)),
    lines: all.length ? all.slice(-rows) : [""],
  };
}

/** Las filas que salieron por arriba, más las visibles: se escriben tras vaciar la terminal. */
export function fullFrame(grid) {
  const rows = [...grid.history, ...grid.lines].map((l) => SEAL + l);
  return `\x1b[?25l${rows.join("\r\n")}${SEAL}${cursorSeq(grid)}`;
}

/** Solo las filas visibles, sobre lo que ya hay (el historial no cambió). */
export function visibleFrame(grid) {
  const rows = grid.lines.map((l) => `${SEAL}\x1b[2K${l}`);
  return `\x1b[?25l\x1b[H${rows.join("\r\n")}${SEAL}${cursorSeq(grid)}`;
}

function cursorSeq(grid) {
  if (!grid.cursor) return "";
  const [row, col] = grid.cursor;
  return `\x1b[${row + 1};${col + 1}H\x1b[?25h`;
}

/** Clave del historial: si no cambia, basta redibujar las filas visibles. */
export function historyKey(grid) {
  return grid.history.join("\n");
}

/** Pasos (en px) con los que se prueban tamaños de letra. */
const FONT_STEP = 0.25;

/**
 * La letra más grande con la que `cols` × `rows` celdas entran en `width` × `height` píxeles.
 * `measure(size)` dice cuánto mide de verdad una celda con esa letra ({ cw, ch }): xterm la
 * redondea a píxeles de pantalla enteros a su manera, así que se mide en vez de calcularla.
 *
 * Modos: `fit` (la terminal entera), `width` (ajustada al ancho; lo que sobra de alto se
 * recorre) y `auto` (entera si así se lee, con READABLE_FONT o más; si no, al ancho y sin bajar de `floor`).
 * Con `tail` (un agente que escribe de arriba abajo, no una aplicación de pantalla completa) `auto` va
 * directo al ancho: lo que importa es el final, y la letra más grande.
 * `slack` son los píxeles que se le perdonan a la caja (el relleno que la rodea los absorbe): con celdas
 * enteras, ganar una columna de píxeles suele pedir unos pocos más de los que hay.
 * Devuelve también si hace falta scroll (la terminal no entra al tamaño elegido).
 */
export function pickFont({ cols, rows, width, height, mode = "fit", measure, slack = 0, floor = FLOOR_FONT, tail = false }) {
  if (!(width > 0) || !(height > 0)) return { size: MIN_FONT, scroll: true };
  const steps = Math.round((MAX_FONT - MIN_FONT) / FONT_STEP);
  const at = (i) => MIN_FONT + i * FONT_STEP;
  const fits = (size, withHeight) => {
    const { cw, ch } = measure(size);
    return cw * cols <= width + slack + 0.5 && (!withHeight || ch * rows <= height + slack + 0.5);
  };
  // Búsqueda binaria del paso más grande que entra (el tamaño de celda solo crece con la letra).
  const biggest = (withHeight) => {
    if (!fits(at(0), withHeight)) return { size: at(0), ok: false };
    let lo = 0;
    let hi = steps;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(at(mid), withHeight)) lo = mid;
      else hi = mid - 1;
    }
    return { size: at(lo), ok: true };
  };
  const whole = biggest(true);
  const overflows = (size) => measure(size).ch * rows > height + slack + 0.5;
  if (mode === "fit") return { size: whole.size, scroll: !whole.ok };
  if (mode === "auto" && !tail && whole.ok && whole.size >= READABLE_FONT) return { size: whole.size, scroll: false };
  const byWidth = biggest(false);
  const size = mode === "auto" ? Math.max(byWidth.size, floor) : byWidth.size;
  return { size, scroll: !byWidth.ok || size > byWidth.size || overflows(size) };
}

/** Los modos que se ofrecen en la página. */
export const TERM_MODES = { auto: "Automática", fit: "Terminal entera", width: "Ajustar al ancho" };
export const DEFAULT_TERM_MODE = "auto";

/** Anchos de tarjeta que reparten bien el lienzo: de a 3, de a 2 o una sola por fila. */
const CARD_WIDTHS = [4, 6, 12];

/**
 * Tamaño inicial de una tarjeta (en columnas y filas del lienzo): el ancho más chico, de los que
 * reparten bien el lienzo, con el que la letra de la terminal sale de TARGET_FONT; y un alto que no
 * pasa de `maxH` (la terminal hace scroll y muestra el final). `chrome` es lo que ocupa la tarjeta
 * fuera de la terminal (cabecera, datos y consola).
 */
export function cardSizeFor({ containerPx, columns, cellPx, cols = 120, rows = 40, chrome = 150, maxH = 24, widths = CARD_WIDTHS }) {
  const colPx = containerPx / columns;
  const fontAt = (w) => Math.min(12, (w * colPx - 32) / (cols * CELL_RATIO));
  const w = widths.find((c) => fontAt(c) >= TARGET_FONT) ?? widths.at(-1) ?? columns;
  const wantH = Math.min(rows, 40) * ROW_RATIO * fontAt(w) + chrome;
  return { w, h: Math.max(10, Math.min(maxH, Math.ceil(wantH / cellPx))) };
}

/** Última fila con algo escrito (o donde está el cursor): hasta ahí importa mostrar, no hasta el final de la pantalla. */
export function lastContentRow(grid) {
  let last = -1;
  for (let i = grid.lines.length - 1; i >= 0; i--) {
    if (stripAnsi(grid.lines[i]).trim() !== "") {
      last = i;
      break;
    }
  }
  return Math.max(last, grid.cursor ? grid.cursor[0] : -1, 0);
}
