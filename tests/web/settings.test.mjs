// Ajustes y presets sin DOM: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanName, DEFAULTS, matchingPreset, normalize, normalizePresets, parseShared, serialize } from "../../web/settings.js";

test("normalize deja valores válidos y completa lo demás con los de base", () => {
  const out = normalize({ layout: "focus", theme: "azul", density: 3, radius: "round", extra: "x" });
  assert.deepEqual(out, { ...DEFAULTS, layout: "focus", radius: "round" });
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.equal(normalize({ layout: "nope" }, { ...DEFAULTS, layout: "grid" }).layout, "grid");
});

test("un preset sobrevive a compartirlo como texto", () => {
  const bundle = { ...DEFAULTS, theme: "dark", termTheme: "solarized", layout: "grid" };
  const parsed = parseShared(serialize(bundle));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.bundle, bundle);
});

test("el texto que no es un preset se rechaza con un motivo", () => {
  assert.match(parseShared("{no json").error, /no es un preset válido/);
  assert.match(parseShared('{"theme":"dark"}').error, /no es un preset de Argos Board/);
  assert.match(parseShared('{"argos":1}').error, /ningún ajuste/);
  assert.equal(parseShared("[]").ok, false);
});

test("los nombres de preset se limpian y los presets guardados se validan", () => {
  assert.equal(cleanName("  Mi   preset \n"), "Mi preset");
  assert.equal(cleanName("x".repeat(100)).length, 40);
  assert.equal(cleanName(undefined), "");
  const presets = normalizePresets({ "  Noche  ": { theme: "dark", layout: "x" }, "": { theme: "dark" }, malo: 5 });
  assert.deepEqual(Object.keys(presets), ["Noche"]);
  assert.deepEqual(presets.Noche, { ...DEFAULTS, theme: "dark" });
});

test("se reconoce el preset guardado que coincide con los ajustes actuales", () => {
  const presets = normalizePresets({ Oscuro: { theme: "dark" }, Claro: {} });
  assert.equal(matchingPreset(presets, { ...DEFAULTS, theme: "dark" }), "Oscuro");
  assert.equal(matchingPreset(presets, DEFAULTS), "Claro");
  assert.equal(matchingPreset(presets, { ...DEFAULTS, radius: "sharp" }), null);
});
