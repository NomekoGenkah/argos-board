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

/**
 * Tamaño de letra para que `cols` × `rows` celdas entren en `width` × `height` píxeles.
 * Las celdas miden píxeles de pantalla enteros (si no, la letra sale borrosa y la terminal más
 * ancha de lo calculado), así que se parte de cuántos píxeles le tocan a cada celda.
 * Devuelve también si hace falta scroll (la letra llegó al mínimo legible).
 */
export function fitFont({ cols, rows, width, height, mode = "fit", dpr = 1 }) {
  if (!(width > 0) || !(height > 0)) return { size: MIN_FONT, scroll: true };
  const snap = (px, cells) => Math.floor((px * dpr) / cells) / dpr; // píxeles de pantalla por celda
  const byWidth = snap(width, cols) / CELL_RATIO - 0.02;
  const byHeight = snap(height, rows) / ROW_RATIO - 0.02;
  const ideal = mode === "width" ? byWidth : Math.min(byWidth, byHeight);
  const size = Math.max(MIN_FONT, Math.min(MAX_FONT, ideal));
  return { size, scroll: ideal < MIN_FONT };
}
