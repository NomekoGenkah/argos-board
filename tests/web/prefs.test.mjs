// Pruebas de las preferencias locales: poda de nombres de agentes que ya no
// existen. `prefs.js` lee `localStorage` al cargarse, así que se simula antes
// de importarlo (una sola importación: el módulo queda cacheado).

import assert from "node:assert/strict";
import { test } from "node:test";

/** `localStorage` de mentira que cuenta las escrituras, para no depender del navegador. */
function fakeStorage(init = {}) {
  const map = new Map(Object.entries(init));
  const storage = {
    writes: 0,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      storage.writes++;
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    get: (k) => map.get(k),
  };
  return storage;
}

test("pruneLayouts y pruneSeats olvidan lo que ya no existe y solo escriben si cambia algo", async () => {
  const storage = fakeStorage({
    "argos-layout": JSON.stringify({ viejo: { x: 0, y: 0, w: 2, h: 2 }, vivo: { x: 1, y: 1, w: 3, h: 4 } }),
    "argos-seats": JSON.stringify({ viejo: 0, vivo: 1 }),
  });
  globalThis.localStorage = storage;
  try {
    const { prefs } = await import("../../web/prefs.js");
    prefs.pruneLayouts(new Set(["vivo"]));
    prefs.pruneSeats(new Set(["vivo"]));
    assert.deepEqual(JSON.parse(storage.get("argos-layout")), { vivo: { x: 1, y: 1, w: 3, h: 4 } });
    assert.deepEqual(JSON.parse(storage.get("argos-seats")), { vivo: 1 });
    assert.equal(storage.writes, 2, "una escritura por cada poda que cambió algo");
    // Segunda pasada: ya no hay nada que olvidar, así que no se escribe.
    prefs.pruneLayouts(new Set(["vivo"]));
    prefs.pruneSeats(new Set(["vivo"]));
    assert.equal(storage.writes, 2);
  } finally {
    delete globalThis.localStorage;
  }
});
