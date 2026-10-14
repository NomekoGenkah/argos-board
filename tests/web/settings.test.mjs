// Ajustes y presets sin DOM: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { allPresets, BUILTIN_PRESETS, CHOICES, cleanName, DEFAULTS, isBuiltin, matchingPreset, normalize, normalizePresets, parseShared, serialize } from "../../web/settings.js";

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
  const presets = normalizePresets({ Claro: { theme: "light" }, Oscuro: {} });
  assert.equal(matchingPreset(presets, { ...DEFAULTS, theme: "light" }), "Claro");
  assert.equal(matchingPreset(presets, DEFAULTS), "Oscuro", "los valores por defecto son los de la Atalaya de noche");
  assert.equal(matchingPreset(presets, { ...DEFAULTS, radius: "sharp" }), null);
});

test("el estilo de base es la Atalaya, de noche; hay cuatro estilos", () => {
  assert.equal(DEFAULTS.skin, "atalaya");
  assert.equal(DEFAULTS.theme, "dark");
  assert.deepEqual(Object.keys(CHOICES.skin), ["atalaya", "cuaderno", "fosforo", "tinta"]);
  assert.equal(normalize({ skin: "otro" }).skin, "atalaya");
});

test("los presets de fábrica son válidos, distintos entre sí y cubren los cuatro estilos", () => {
  const names = Object.keys(BUILTIN_PRESETS);
  assert.equal(names.length, 4);
  for (const name of names) assert.deepEqual(normalize(BUILTIN_PRESETS[name]), BUILTIN_PRESETS[name], `${name} trae valores inválidos`);
  assert.equal(new Set(names.map((n) => JSON.stringify(BUILTIN_PRESETS[n]))).size, 4);
  assert.deepEqual(new Set(names.map((n) => BUILTIN_PRESETS[n].skin)), new Set(Object.keys(CHOICES.skin)));
});

test("los presets de fábrica y los del usuario se juntan; el del usuario gana y solo los de fábrica sin reemplazo cuentan como tales", () => {
  const [first] = Object.keys(BUILTIN_PRESETS);
  const mine = normalizePresets({ [first]: { skin: "tinta" }, Propio: {} });
  const all = allPresets(mine);
  assert.equal(all[first].skin, "tinta");
  assert.ok(Object.keys(all).includes("Propio"));
  assert.equal(Object.keys(all).length, Object.keys(BUILTIN_PRESETS).length + 1);
  assert.equal(isBuiltin(first, mine), false, "reemplazado por uno propio");
  assert.equal(isBuiltin(first, {}), true);
  assert.equal(isBuiltin("Propio", mine), false);
});
