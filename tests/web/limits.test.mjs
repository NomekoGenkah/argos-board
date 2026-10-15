// Pruebas de los límites de tamaño compartidos: `node --test tests/web/*.test.mjs`
// El servidor mide bytes UTF-8, así que la página también.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_INPUT_BYTES, byteLength, clipToBytes } from "../../web/limits.js";

test("byteLength cuenta bytes UTF-8, no caracteres", () => {
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength("á"), 2); // acento: 2 bytes
  assert.equal(byteLength("😀"), 4); // emoji fuera del BMP: 4 bytes
  assert.equal(byteLength("aá😀"), 1 + 2 + 4);
  assert.equal(byteLength(""), 0);
});

test("clipToBytes deja intacto lo que cabe", () => {
  assert.equal(clipToBytes("hola", 4), "hola");
  assert.equal(clipToBytes("hola", 100), "hola");
  assert.equal(clipToBytes("", 0), "");
});

test("clipToBytes recorta a lo sumo max bytes", () => {
  assert.equal(clipToBytes("x".repeat(10), 4), "xxxx");
  assert.equal(byteLength(clipToBytes("á".repeat(10), 5)), 4); // 2 por «á», el 5.º byte no cabe
  assert.equal(clipToBytes("á".repeat(10), 5), "áá");
});

test("clipToBytes no parte un carácter ni un par suplente", () => {
  // Con 3 bytes no cabe ningún emoji de 4; con 4 cabe exacto.
  assert.equal(clipToBytes("😀", 3), "");
  assert.equal(clipToBytes("😀", 4), "😀");
  // Dos emojis con 5 bytes: solo el primero.
  assert.equal(clipToBytes("😀😀", 5), "😀");
  // La salida nunca contiene el carácter de reemplazo U+FFFD.
  assert.ok(!clipToBytes("a😀b", 2).includes("\uFFFD"));
});

test("clipToBytes respeta el tope real de la consola", () => {
  const out = clipToBytes("x".repeat(MAX_INPUT_BYTES + 1));
  assert.equal(byteLength(out), MAX_INPUT_BYTES);
  assert.equal(out.length, MAX_INPUT_BYTES); // ASCII: bytes = unidades
});
