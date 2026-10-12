// Fondos ANSI de la pantalla del agente: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { ansiToHtml } from "../../web/ansi.js";

test("el fondo 100 usa el gris neutro de fondo, no el café del texto", () => {
  const html = ansiToHtml("\x1b[37;100m❯ \x1b[97mhola\x1b[39m\x1b[m", true);
  assert.match(html, /background-color: var\(--ansi-bg-bright-black/);
  assert.doesNotMatch(html, /background-color: var\(--ansi-bright-black/);
});

test("el fondo 256 colores 8 y el 40 también usan los grises de fondo", () => {
  assert.match(ansiToHtml("\x1b[48;5;8mx\x1b[m", true), /var\(--ansi-bg-bright-black/);
  assert.match(ansiToHtml("\x1b[40mx\x1b[m", true), /var\(--ansi-bg-black/);
});

test("los tramos con fondo llevan la clase bg y los demás no", () => {
  const html = ansiToHtml("\x1b[100m  \x1b[97mtexto\x1b[39m\x1b[m \x1b[91mrojo\x1b[m", true);
  assert.match(html, /<span class="bg" style="background-color/);
  assert.match(html, /<span style="color: var\(--ansi-bright-red/);
});

test("una fila solo de fondo sigue siendo una barra", () => {
  assert.match(ansiToHtml("\x1b[100m      \x1b[m", true), /class="bar-row"/);
});
