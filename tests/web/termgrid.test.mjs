// Datos de la terminal sin DOM: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { cardSizeFor, fullFrame, gridOf, historyKey, MIN_FONT, pickFont, READABLE_FONT, ROW_RATIO, CELL_RATIO, visibleFrame } from "../../web/termgrid.js";

const grid = (extra = {}) => ({ cols: 40, rows: 10, alt: false, cursor: null, history: [], lines: ["uno", "dos"], ...extra });

test("la rejilla exacta del wrapper se usa tal cual", () => {
  const g = grid();
  assert.equal(gridOf({ grid: g, last_lines: ["otra cosa"] }), g);
});

test("con un wrapper anterior, la rejilla sale de las líneas: ancho de la más larga y el resto de historial", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `\x1b[31mfila ${i}\x1b[m`);
  lines[3] = "x".repeat(100);
  const g = gridOf({ last_lines: lines });
  assert.equal(g.cols, 100);
  assert.equal(g.lines.length, 40);
  assert.equal(g.history.length, 10);
  assert.equal(g.cursor, null);
  assert.deepEqual(gridOf({ last_lines: [] }).lines, [""]);
});

test("el cuadro completo lleva el historial y las filas, y cierra los estilos de cada una", () => {
  const f = fullFrame(grid({ history: ["viejo"], lines: ["a", "b"], cursor: [1, 2] }));
  assert.equal(f, "\x1b[?25l\x1b[0mviejo\r\n\x1b[0ma\r\n\x1b[0mb\x1b[0m\x1b[2;3H\x1b[?25h");
});

test("el cuadro de filas visibles vuelve al inicio, borra cada fila y oculta el cursor si no hay", () => {
  const f = visibleFrame(grid({ lines: ["a", "b"] }));
  assert.equal(f, "\x1b[?25l\x1b[H\x1b[0m\x1b[2Ka\r\n\x1b[0m\x1b[2Kb\x1b[0m");
});

test("la clave del historial cambia solo si cambia el historial", () => {
  assert.equal(historyKey(grid({ lines: ["a"] })), historyKey(grid({ lines: ["b"] })));
  assert.notEqual(historyKey(grid({ history: ["x"] })), historyKey(grid()));
});

// Como xterm: la celda mide píxeles enteros (el ancho se redondea hacia abajo, el alto hacia arriba).
const measure = (size) => ({ cw: Math.floor(size * CELL_RATIO), ch: Math.ceil(size * ROW_RATIO) });
const pick = (o) => pickFont({ measure, ...o });

test("la letra elegida es la más grande con la que la terminal entra en la caja", () => {
  const { size, scroll } = pick({ cols: 120, rows: 40, width: 781, height: 508 });
  assert.equal(scroll, false);
  const fits = (s) => measure(s).cw * 120 <= 781 && measure(s).ch * 40 <= 508;
  assert.ok(fits(size));
  assert.ok(!fits(size + 0.25) || size === 18, "una más grande ya no entra");
});

test("en modo ancho manda el ancho; en modo entera, el lado que más aprieta", () => {
  const fit = pick({ cols: 100, rows: 100, width: 600, height: 600 });
  const width = pick({ cols: 100, rows: 100, width: 600, height: 600, mode: "width" });
  assert.ok(width.size > fit.size);
  assert.equal(width.scroll, true, "al ancho sobra alto: se recorre");
});

test("si la letra bajaría del mínimo se queda en el mínimo y pide scroll", () => {
  const r = pick({ cols: 200, rows: 60, width: 300, height: 200 });
  assert.equal(r.size, MIN_FONT);
  assert.equal(r.scroll, true);
  assert.deepEqual(pick({ cols: 80, rows: 24, width: 0, height: 0 }), { size: MIN_FONT, scroll: true });
});

test("auto: si la terminal entera se lee, entra entera; si no, se ajusta al ancho sin bajar de lo legible", () => {
  const big = pick({ cols: 120, rows: 40, width: 781, height: 508, mode: "auto" });
  assert.equal(big.scroll, false);
  assert.ok(big.size >= READABLE_FONT);

  const small = pick({ cols: 120, rows: 40, width: 468, height: 245, mode: "auto" });
  assert.equal(small.size, READABLE_FONT, "al ancho daría menos de lo legible");
  assert.equal(small.scroll, true);

  // Ancho de sobra pero poco alto: se ajusta al ancho y solo recorre en vertical.
  const wide = pick({ cols: 100, rows: 40, width: 900, height: 250, mode: "auto" });
  assert.ok(wide.size > READABLE_FONT);
  assert.equal(wide.scroll, true);
  assert.ok(measure(wide.size).cw * 100 <= 900);
});

test("la tarjeta nueva se dimensiona para una letra legible según el ancho del lienzo", () => {
  const at = (containerPx) => cardSizeFor({ containerPx, columns: 12, cellPx: 24 });
  assert.equal(at(1568).w, 6, "en pantalla ancha, dos por fila");
  assert.ok(at(1248).w >= 7, "más angosta, cada una pide más columnas");
  assert.ok(at(600).w === 12 || at(600).w <= 12);
  assert.ok(at(1568).h <= 34);
  assert.equal(cardSizeFor({ containerPx: 1568, columns: 12, cellPx: 24, cols: 20, rows: 5 }).w, 4, "nunca menos de 4 columnas");
});
