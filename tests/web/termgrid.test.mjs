// Datos de la terminal sin DOM: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { fitFont, fullFrame, gridOf, historyKey, MIN_FONT, ROW_RATIO, CELL_RATIO, visibleFrame } from "../../web/termgrid.js";

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

test("la letra se ajusta a píxeles enteros por celda y la terminal entra en la caja", () => {
  for (const dpr of [1, 1.5, 2]) {
    const { size, scroll } = fitFont({ cols: 120, rows: 40, width: 781, height: 508, dpr });
    assert.equal(scroll, false);
    const cellW = size * CELL_RATIO;
    const cellH = size * ROW_RATIO;
    assert.ok(cellW * 120 <= 781 + 1e-6, `ancho ${cellW * 120} con dpr ${dpr}`);
    assert.ok(cellH * 40 <= 508 + 1e-6, `alto ${cellH * 40} con dpr ${dpr}`);
  }
});

test("en modo ancho manda el ancho; en modo entera, el lado que más aprieta", () => {
  const fit = fitFont({ cols: 100, rows: 100, width: 600, height: 600 });
  const width = fitFont({ cols: 100, rows: 100, width: 600, height: 600, mode: "width" });
  assert.ok(width.size > fit.size);
});

test("si la letra bajaría del mínimo se queda en el mínimo y pide scroll", () => {
  const r = fitFont({ cols: 200, rows: 60, width: 300, height: 200 });
  assert.equal(r.size, MIN_FONT);
  assert.equal(r.scroll, true);
  assert.deepEqual(fitFont({ cols: 80, rows: 24, width: 0, height: 0 }), { size: MIN_FONT, scroll: true });
});
