// Contraste de los colores de cada estilo (WCAG 2.1 AA), leído de skins.css: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../../web/skins.css", import.meta.url), "utf8");

/** { "atalaya/dark": { "--bg": "#0e1318", ... }, ... } */
function parseSkins(text) {
  const out = {};
  for (const m of text.matchAll(/(^|\n)((?::root[^{]*?)\{[^}]*\})/g)) {
    const block = m[2];
    const sel = block.slice(0, block.indexOf("{"));
    const key = /data-skin="(\w+)"\]\[data-theme="(\w+)"\]/.exec(sel);
    if (!key) continue;
    const vars = {};
    for (const v of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) vars[v[1]] = v[2];
    out[`${key[1]}/${key[2]}`] = vars;
    // El primer bloque es también el de base (sin atributos).
    if (/^:root,\s*\n?:root\[/.test(sel.trim())) out.base = vars;
  }
  return out;
}

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const skins = parseSkins(css);
const NAMES = ["atalaya", "cuaderno", "fosforo", "tinta"].flatMap((s) => ["dark", "light"].map((t) => `${s}/${t}`));

// [texto, fondo, mínimo]: el texto normal pide 4,5; lo que no es texto (el aro de foco), 3.
const PAIRS = [
  ["--text", "--bg", 4.5],
  ["--text", "--panel", 4.5],
  ["--heading", "--panel", 4.5],
  ["--muted", "--bg", 4.5],
  ["--muted", "--panel", 4.5],
  ["--muted", "--panel-2", 4.5],
  ["--st-waiting", "--panel", 4.5],
  ["--st-working", "--panel", 4.5],
  ["--st-error", "--panel", 4.5],
  ["--st-ended", "--panel-2", 4.5],
  ["--accent-strong", "--panel", 4.5],
  ["--on-accent", "--accent", 4.5],
  ["--focus", "--bg", 3],
  ["--focus", "--panel", 3],
];

test("están los ocho estilos y cada uno define todos los colores que usa la página", () => {
  for (const name of NAMES) {
    assert.ok(skins[name], `falta ${name}`);
    for (const [a, b] of PAIRS) {
      assert.ok(skins[name][a] && skins[name][b], `${name}: falta ${a} o ${b}`);
    }
    for (const v of ["--k-claude", "--k-agy", "--k-copilot", "--k-opencode", "--k-generic", "--brand", "--st-idle", "--st-working-dot", "--term-bg"]) {
      assert.ok(skins[name][v], `${name}: falta ${v}`);
    }
  }
  assert.deepEqual(skins.base, skins["atalaya/dark"], "sin atributos, la página es la Atalaya de noche");
});

for (const name of NAMES) {
  test(`${name}: los pares de color de texto y de interfaz cumplen el contraste`, () => {
    const failures = [];
    for (const [a, b, min] of PAIRS) {
      const r = ratio(skins[name][a], skins[name][b]);
      if (r < min) failures.push(`${a} sobre ${b}: ${r.toFixed(2)} (mínimo ${min})`);
    }
    assert.deepEqual(failures, []);
  });
}

test("la marca se ve sobre el fondo de cada estilo (es un trazo, pide 3)", () => {
  for (const name of NAMES) assert.ok(ratio(skins[name]["--brand"], skins[name]["--panel"]) >= 3, `${name}: ${ratio(skins[name]["--brand"], skins[name]["--panel"]).toFixed(2)}`);
});
