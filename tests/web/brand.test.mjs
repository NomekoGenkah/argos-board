// La marca sin DOM: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { eyeSvg, gazeOf, svgHref } from "../../web/brand.js";

test("el ojo lleva los colores que se le piden", () => {
  const svg = eyeSvg({ lid: "#f2b84b", pupil: "#ff5a45" });
  assert.match(svg, /stroke="#f2b84b"/);
  assert.match(svg, /fill="#ff5a45"/);
  assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
});

test("el icono es una dirección data: que el navegador acepta", () => {
  const href = svgHref(eyeSvg({ lid: "#fff", pupil: "#000" }));
  assert.ok(href.startsWith("data:image/svg+xml,"));
  assert.ok(!href.includes("<"), "el SVG va codificado");
});

test("la marca mira lo más urgente, y a nada si no hay agentes", () => {
  assert.equal(gazeOf("wait", 3), "wait");
  assert.equal(gazeOf("calm", 1), "calm");
  assert.equal(gazeOf("wait", 0), "none");
  assert.equal(gazeOf("desconocido", 2), "none");
});
