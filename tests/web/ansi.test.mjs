// Texto con secuencias ANSI: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { stripAnsi } from "../../web/ansi.js";

test("stripAnsi quita colores y estilos y deja el texto", () => {
  assert.equal(stripAnsi("\x1b[1;31mrojo\x1b[0m y \x1b[38;2;1;2;3mverde\x1b[m"), "rojo y verde");
  assert.equal(stripAnsi(""), "");
  assert.equal(stripAnsi(undefined), "");
});

test("el avance de cursor se convierte en espacios, como en la pantalla", () => {
  assert.equal(stripAnsi("a\x1b[3Cb"), "a   b");
  assert.equal(stripAnsi("a\x1b[Cb"), "a b");
});

test("quita también los títulos y enlaces de la terminal (OSC)", () => {
  assert.equal(stripAnsi("\x1b]0;titulo\x07hola"), "hola");
  assert.equal(stripAnsi("\x1b]8;;http://x\x1b\\enlace\x1b]8;;\x1b\\"), "enlace");
});
