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
