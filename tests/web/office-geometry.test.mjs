// Geometría de la Oficina: reparto de zonas, sitios de pie y puerta. Puro, sin
// DOM: se le dan tamaños y cuántos hay en cada zona.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WALL_H,
  ZPAD,
  LABEL_H,
  POD_W,
  POD_H,
  SLOT_W,
  SLOT_TOP,
  UNIT_W,
  YOUR_DESK_W,
  seatsUsed,
  sceneLayout,
  bestLayout,
  podOrigin,
  door,
  kitchenLeft,
  computeTargets,
  zoneAt,
  portals,
  route,
  polylineLength,
  pointAlong,
  headingAlong,
  separate,
} from "../../web/office-geometry.js";
import { pickScale, ZONE_ORDER } from "../../web/office-pure.js";

const counts = (o = {}) => ({ desks: 1, queue: 0, kitchen: 0, exit: 0, ...o });
const agent = (id, state = "working") => ({ id, name: id, state, kind: "generic" });

test("seatsUsed: el mayor asiento ocupado manda", () => {
  assert.equal(seatsUsed(new Map([["a", 0], ["b", 3]])), 4);
  assert.equal(seatsUsed(new Map()), 1, "sin nadie, al menos un escritorio");
});

test("sceneLayout estrecho: las zonas se apilan en ZONE_ORDER", () => {
  const l = sceneLayout(2, 300, counts()); // vw = 150 < 330
  let y = WALL_H;
  for (const zone of ZONE_ORDER) {
    const z = l.zones[zone];
    assert.equal(z.x, 0, `${zone} ocupa todo el ancho`);
    assert.equal(z.w, l.vw);
    assert.equal(z.y, y, `${zone} va justo debajo`);
    y += z.h;
  }
  assert.equal(l.vh, y, "el alto total es la suma apilada");
});

test("sceneLayout ancho: dos columnas (fila+salida / oficina+cocina)", () => {
  const l = sceneLayout(3, 1200, counts()); // vw = 400 >= 330
  assert.equal(l.zones.queue.y, WALL_H);
  assert.equal(l.zones.exit.y, WALL_H, "salida a la altura de la fila");
  assert.equal(l.zones.exit.x, l.zones.queue.w, "la columna derecha empieza donde acaba la izquierda");
  assert.equal(l.zones.kitchen.x, l.zones.exit.x);
  assert.ok(l.zones.office.y > l.zones.queue.y, "la oficina va debajo de la fila");
  assert.equal(l.zones.office.y, l.zones.kitchen.y);
});

test("bestLayout: coge la escala mayor que cabe de alto; si no, la del ancho", () => {
  const tall = bestLayout({ cssW: 1200, availH: 4000, counts: counts() });
  assert.equal(tall.scale, 4, "con sitio de sobra, la escala mayor");
  const tight = bestLayout({ cssW: 1200, availH: 200, counts: counts() });
  assert.equal(tight.scale, pickScale(1200), "sin sitio, la que marca el ancho");
});

test("podOrigin: coloca los asientos por filas y columnas", () => {
  const l = sceneLayout(3, 1200, counts({ desks: 6 }));
  const first = podOrigin(l, 0);
  assert.equal(first.x, l.office.left);
  assert.equal(first.y, l.zones.office.y + LABEL_H);
  const nextRow = podOrigin(l, l.office.cols);
  assert.equal(nextRow.x, l.office.left, "vuelve a la primera columna");
  assert.equal(nextRow.y, first.y + l.rowH, "una fila más abajo");
});

test("door: la puerta cae dentro de la salida", () => {
  const l = sceneLayout(3, 1200, counts());
  const d = door(l);
  assert.equal(d.y, l.zones.exit.y + LABEL_H);
  assert.ok(d.x > l.zones.exit.x && d.x < l.zones.exit.x + l.zones.exit.w);
});

test("kitchenLeft: centra las mesas (una unidad) en la cocina", () => {
  const l = sceneLayout(3, 1200, counts({ kitchen: 1 }));
  assert.equal(kitchenLeft(l, 1), l.zones.kitchen.x + Math.floor((l.zones.kitchen.w - UNIT_W) / 2));
});

test("computeTargets: un sitio de pie por agente, en su zona", () => {
  const groups = {
    office: [agent("o1")],
    queue: [agent("q1", "waiting_input")],
    kitchen: [agent("k1", "idle")],
    exit: [agent("e1", "exited")],
  };
  const seatOf = new Map([["o1", 0]]);
  const l = sceneLayout(3, 1200, counts({ desks: 1, queue: 1, kitchen: 1, exit: 1 }));
  const t = computeTargets(l, groups, seatOf);

  assert.equal(t.size, 4);
  const o = t.get("o1");
  assert.equal(o.mx, l.office.left + 32);
  assert.equal(o.rect.w, POD_W);
  assert.equal(o.plateTop, POD_H);

  const q = t.get("q1");
  assert.equal(q.mx, l.zones.queue.x + ZPAD + YOUR_DESK_W + 11);
  assert.equal(q.my, l.zones.queue.y + LABEL_H + 14);
  assert.equal(q.plateTop, SLOT_TOP);
  assert.equal(q.rect.w, SLOT_W);

  const k = t.get("k1");
  assert.equal(k.mx, kitchenLeft(l, 1) + 8, "taburete izquierdo");
  assert.equal(k.rect.x, kitchenLeft(l, 1));

  const e = t.get("e1");
  assert.equal(e.my, l.zones.exit.y + LABEL_H + 12);
});

// --- Navegación y separación ---------------------------------------------------

const inZone = (l, name) => ({ x: l.zones[name].x + 2, y: l.zones[name].y + LABEL_H + 2 });
const pairKey = (p) => [p.a, p.b].sort().join("|");

test("zoneAt: sabe en qué zona cae un punto", () => {
  const l = sceneLayout(3, 1200, counts({ desks: 1, queue: 1, kitchen: 1, exit: 1 }));
  for (const name of ZONE_ORDER) {
    const pt = { x: l.zones[name].x + 2, y: l.zones[name].y + 2 };
    assert.equal(zoneAt(l, pt.x, pt.y), name);
  }
});

test("portals: un paso por cada par de zonas vecinas", () => {
  const wide = sceneLayout(3, 1200, counts({ desks: 1, queue: 1, kitchen: 1, exit: 1 }));
  const widePairs = portals(wide).map(pairKey).sort();
  assert.deepEqual(widePairs, ["exit|kitchen", "exit|queue", "kitchen|office", "office|queue"]);
  for (const p of portals(wide)) {
    assert.ok(p.x >= 0 && p.y >= WALL_H, "el paso cae dentro de la escena");
  }
  const narrow = sceneLayout(2, 300, counts({ desks: 1, queue: 1, kitchen: 1, exit: 1 }));
  assert.deepEqual(narrow && portals(narrow).map(pairKey).sort(), ["exit|kitchen", "kitchen|office", "office|queue"]);
});

test("route: misma zona va recta (sin puntos de paso)", () => {
  const l = sceneLayout(3, 1200, counts({ desks: 2 }));
  const a = inZone(l, "office");
  const b = { x: a.x + 20, y: a.y + 20 };
  assert.deepEqual(route(l, a, b), []);
});

test("route: cruza por el hueco del tabique, no en línea recta", () => {
  const l = sceneLayout(3, 1200, counts({ desks: 1, queue: 1 }));
  const from = { x: 1, y: l.zones.office.y + 40 };
  const to = { x: 1, y: l.zones.queue.y + 20 };
  const r = route(l, from, to);
  assert.equal(r.length, 1, "un solo tabique de por medio");
  assert.equal(r[0].y, l.zones.office.y, "el paso está en el borde entre las dos zonas");
});

test("route: entre zonas lejanas pasa por dos pasos", () => {
  const l = sceneLayout(3, 1200, counts({ desks: 1, queue: 1, kitchen: 1, exit: 1 }));
  const r = route(l, inZone(l, "office"), inZone(l, "exit"));
  assert.equal(r.length, 2);
  for (const p of r) {
    const onEdge = (v, lo, hi) => Math.abs(v - lo) < 1 || Math.abs(v - hi) < 1;
    const someBoundary = ZONE_ORDER.some((n) => {
      const z = l.zones[n];
      return (onEdge(p.x, z.x, z.x + z.w) && p.y >= z.y && p.y <= z.y + z.h) || (onEdge(p.y, z.y, z.y + z.h) && p.x >= z.x && p.x <= z.x + z.w);
    });
    assert.ok(someBoundary, "cada paso cae en el borde de una zona");
  }
});

test("polylineLength y pointAlong: largo y punto a una distancia", () => {
  assert.equal(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
  assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 4), { x: 4, y: 0 });
  assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 15), { x: 10, y: 5 });
  assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 99), { x: 10, y: 0 }, "no se pasa del final");
  assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], -3), { x: 0, y: 0 }, "no se pasa del principio");
});

test("headingAlong: la dirección del tramo actual (0 si es vertical)", () => {
  const l = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.equal(headingAlong(l, 5), 1, "primer tramo hacia la derecha");
  assert.equal(headingAlong(l, 15), 0, "segundo tramo vertical: sin dirección");
  assert.equal(headingAlong([{ x: 0, y: 0 }, { x: -10, y: 2 }], 4), -1, "hacia la izquierda");
});

test("separate: dos que caminan se apartan hasta la distancia mínima", () => {
  const out = separate(
    [
      { id: "a", x: 0, y: 0, movable: true },
      { id: "b", x: 1, y: 0, movable: true },
    ],
    12,
  );
  const a = out.get("a");
  const b = out.get("b");
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 12 - 0.01, "quedan separados");
  assert.ok(a.x < 0 && b.x > 1, "el empuje va hacia fuera");
});

test("separate: el que está quieto no se mueve", () => {
  const out = separate(
    [
      { id: "m", x: 0, y: 0, movable: true },
      { id: "f", x: 1, y: 0, movable: false },
    ],
    12,
  );
  assert.equal(out.has("f"), false, "el quieto no se devuelve ni se toca");
  assert.ok(Math.hypot(out.get("m").x - 1, out.get("m").y) >= 12 - 0.01, "el que camina se aparta");
});

test("separate: lejos no cambia nada y solapar del todo no explota", () => {
  const far = separate(
    [
      { id: "a", x: 0, y: 0, movable: true },
      { id: "b", x: 100, y: 0, movable: true },
    ],
    12,
  );
  assert.deepEqual(far.get("a"), { x: 0, y: 0 });

  const stack = separate(
    [
      { id: "a", x: 5, y: 5, movable: true },
      { id: "b", x: 5, y: 5, movable: true },
    ],
    12,
  );
  const d = Math.hypot(stack.get("a").x - stack.get("b").x, stack.get("a").y - stack.get("b").y);
  assert.ok(Number.isFinite(d) && d >= 12 - 0.01, "se acaban separando");
});
