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

test("sobre un fondo RGB propio el texto claro no se oscurece en el tema claro", () => {
  const box = "\x1b[38;2;255;255;255;48;2;30;30;30mhola\x1b[m";
  assert.match(ansiToHtml(box, false), /color: rgb\(255, 255, 255\); background-color: rgb\(30, 30, 30\)/);
  // En orden inverso (fondo y luego color) pasa igual, y también con 256 colores.
  const reversed = "\x1b[48;2;30;30;30m\x1b[38;2;255;255;255mhola\x1b[m";
  assert.match(ansiToHtml(reversed, false), /color: rgb\(255, 255, 255\)/);
  assert.match(ansiToHtml("\x1b[48;5;236m\x1b[38;5;255mhola\x1b[m", false), /color: rgb\(238, 238, 238\)/);
});

test("sin fondo propio el texto claro sí se oscurece en el tema claro", () => {
  assert.doesNotMatch(ansiToHtml("\x1b[38;2;255;255;255mhola\x1b[m", false), /color: rgb\(255, 255, 255\)/);
});
