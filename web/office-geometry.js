// Geometría de la Oficina: cuánto mide cada zona y dónde cae cada cosa.
// Puro (sin DOM): recibe tamaños y cuántos hay en cada zona, y devuelve
// coordenadas. El dibujo y el DOM viven en office.js.

import { pickScale, ZONE_ORDER } from "./office-pure.js";

// Tamaños base, en píxeles de escena (1 px de escena = `scale` px de pantalla).
export const WALL_H = 44; // pared de arriba
export const ZPAD = 5; // margen interior de cada zona
export const LABEL_H = 14; // franja del cartel de la zona
export const PLATE_PX = 40; // alto de la placa HTML, en px de pantalla
export const POD_W = 56; // escritorio
export const POD_H = 42;
export const SLOT_W = 38; // hueco de una mascota (fila, cocina o salida)
export const SLOT_TOP = 30; // alto del hueco sin la placa
export const UNIT_W = 76; // mesa de la cocina con dos taburetes
export const COUNTER_H = 22;
export const YOUR_DESK_W = 56; // tu escritorio, frente a la fila
export const DOOR_W = 30;

// La mascota no se dibuja en la esquina del hueco, sino desplazada a su sitio.
const SPOT = {
  office: { x: 32, y: 10 },
  queue: { x: 11, y: 14 },
  kitchen: [
    { x: 8, y: 9 }, // taburete izquierdo
    { x: 52, y: 9 }, // taburete derecho
  ],
  exit: { x: 11, y: 12 },
};

// Caja del botón mientras la mascota camina (no está en su hueco).
export const WALK_INSET = { x: 11, y: 12 };
// Etiqueta del escritorio de quien anda fuera: separación por dentro del hueco.
export const TAG_INSET = { x: 4, y: 8 };

const WIDE_VW = 330; // a partir de aquí la oficina usa dos columnas
const RIGHT_FRAC = 0.4; // ancho máximo de la columna derecha (salida + cocina)
const EXIT_MAX_SLOTS = 3; // la salida no se ensancha por más gente
const KITCHEN_MAX_UNITS = 2;
const QUEUE_MIN_H = 38; // alto mínimo de la fila (cabe tu escritorio)
const EXIT_MIN_H = 34;
const SLOT_GAP = 3; // hueco extra bajo la placa, en la fila
const ROW_GAP = 5; // hueco extra bajo la placa, en la oficina
const SLOT_BOX_GAP = 2; // el botón del hueco no toca el borde
const POD_BOX_GAP = 3; // ídem para el escritorio
const DOOR_INSET = 20; // la puerta, desde el borde derecho de la salida

/** Escritorios que hacen falta para sentar a todos (el mayor asiento + 1). */
export function seatsUsed(seatOf) {
  return Math.max(1, ...[...seatOf.values()].map((s) => s + 1));
}

/**
 * Reparte las zonas con una escala dada. `counts` = `{ desks, queue, kitchen,
 * exit }`. Devuelve escalas, alto total y el rectángulo de cada zona.
 */
export function sceneLayout(scale, cssW, counts) {
  const vw = Math.max(150, Math.floor(cssW / scale));
  const plateV = Math.ceil(PLATE_PX / scale);
  const slotH = SLOT_TOP + plateV + SLOT_GAP;
  const rowH = POD_H + plateV + ROW_GAP;
  const desksUsed = counts.desks;
  const n = { queue: counts.queue, kitchen: counts.kitchen, exit: counts.exit };

  const queuePerRow = (w) => Math.max(1, Math.floor((w - 2 * ZPAD - YOUR_DESK_W) / SLOT_W));
  const exitPerRow = (w) => Math.max(1, Math.floor((w - 2 * ZPAD - DOOR_W) / SLOT_W));
  const officeCols = (w) => Math.max(1, Math.floor((w - 2 * ZPAD) / POD_W));
  const unitsPerRow = (w) => Math.max(1, Math.floor((w - 2 * ZPAD) / UNIT_W));
  const rows = (count, perRow) => Math.max(1, Math.ceil(count / perRow));
  const height = {
    queue: (w) => LABEL_H + Math.max(QUEUE_MIN_H, rows(n.queue, queuePerRow(w)) * slotH) + ZPAD,
    exit: (w) => LABEL_H + Math.max(EXIT_MIN_H, rows(n.exit, exitPerRow(w)) * slotH) + ZPAD,
    office: (w) => LABEL_H + rows(desksUsed, officeCols(w)) * rowH + ZPAD,
    kitchen: (w) => LABEL_H + COUNTER_H + rows(Math.ceil(n.kitchen / 2), unitsPerRow(w)) * slotH + ZPAD,
  };

  const zones = {};
  if (vw >= WIDE_VW) {
    // La columna derecha (salida y cocina) crece con quienes están ahí.
    const units = Math.min(KITCHEN_MAX_UNITS, Math.max(1, Math.ceil(n.kitchen / 2)));
    const exitW = DOOR_W + SLOT_W * Math.min(EXIT_MAX_SLOTS, Math.max(1, n.exit));
    const rw = Math.min(Math.floor(vw * RIGHT_FRAC), Math.max(units * UNIT_W, exitW)) + 2 * ZPAD;
    const lw = vw - rw;
    const h1 = Math.max(height.queue(lw), height.exit(rw));
    const h2 = Math.max(height.office(lw), height.kitchen(rw));
    zones.queue = { x: 0, y: WALL_H, w: lw, h: h1 };
    zones.exit = { x: lw, y: WALL_H, w: rw, h: h1 };
    zones.office = { x: 0, y: WALL_H + h1, w: lw, h: h2 };
    zones.kitchen = { x: lw, y: WALL_H + h1, w: rw, h: h2 };
  } else {
    // Estrecho: las zonas se apilan en el orden de lectura.
    let y = WALL_H;
    for (const z of ZONE_ORDER) {
      const h = height[z](vw);
      zones[z] = { x: 0, y, w: vw, h };
      y += h;
    }
  }
  const vh = Math.max(...Object.values(zones).map((z) => z.y + z.h));
  const cols = officeCols(zones.office.w);
  const office = {
    cols,
    seats: Math.max(desksUsed, Math.min(cols, 3)), // sin rellenar filas con escritorios vacíos
    left: zones.office.x + Math.floor((zones.office.w - cols * POD_W) / 2),
  };
  return {
    scale,
    vw,
    vh,
    plateV,
    slotH,
    rowH,
    zones,
    office,
    queuePerRow: queuePerRow(zones.queue.w),
    exitPerRow: exitPerRow(zones.exit.w),
    unitsPerRow: unitsPerRow(zones.kitchen.w),
  };
}

/**
 * La escala más grande con la que la oficina cabe de alto; si no cabe ninguna,
 * la que marca el ancho (y habrá scroll).
 */
export function bestLayout({ cssW, availH, counts }) {
  const byWidth = pickScale(cssW);
  for (const scale of [4, 3]) {
    if (scale < byWidth - 1 || cssW / scale < 150) continue;
    const l = sceneLayout(scale, cssW, counts);
    if (l.vh * scale <= availH) return l;
  }
  return sceneLayout(byWidth, cssW, counts);
}

/** Origen (arriba a la izquierda) del escritorio número `seat`. */
export function podOrigin(layout, seat) {
  const { office, rowH, zones } = layout;
  return {
    x: office.left + (seat % office.cols) * POD_W,
    y: zones.office.y + LABEL_H + Math.floor(seat / office.cols) * rowH,
  };
}

/** Caja de un hueco (fila, cocina o salida) en `(sx, sy)`. */
export function slotRect(layout, sx, sy) {
  return { x: sx, y: sy, w: SLOT_W, h: layout.slotH - SLOT_BOX_GAP };
}

/** Esquina de la puerta de salida. */
export function door(layout) {
  const z = layout.zones.exit;
  return { x: z.x + z.w - ZPAD - DOOR_INSET, y: z.y + LABEL_H };
}

/** Borde izquierdo de las mesas de la cocina, para centrarlas en la zona. */
export function kitchenLeft(layout, kitchenCount) {
  const z = layout.zones.kitchen;
  const units = Math.max(1, Math.ceil(kitchenCount / 2));
  return z.x + Math.floor((z.w - Math.min(layout.unitsPerRow, units) * UNIT_W) / 2);
}

/** Dónde tiene que estar cada agente según su estado (hueco y punto de pie). */
export function computeTargets(layout, groups, seatOf) {
  const t = new Map();
  const { zones, slotH } = layout;
  for (const a of groups.office) {
    const { x, y } = podOrigin(layout, seatOf.get(a.id));
    t.set(a.id, {
      mx: x + SPOT.office.x,
      my: y + SPOT.office.y,
      rect: { x, y, w: POD_W, h: layout.rowH - POD_BOX_GAP },
      plateTop: POD_H,
    });
  }
  groups.queue.forEach((a, i) => {
    const z = zones.queue;
    const per = layout.queuePerRow;
    const sx = z.x + ZPAD + YOUR_DESK_W + (i % per) * SLOT_W;
    const sy = z.y + LABEL_H + Math.floor(i / per) * slotH;
    t.set(a.id, { mx: sx + SPOT.queue.x, my: sy + SPOT.queue.y, rect: slotRect(layout, sx, sy), plateTop: SLOT_TOP });
  });
  const left = kitchenLeft(layout, groups.kitchen.length);
  groups.kitchen.forEach((a, i) => {
    const z = zones.kitchen;
    const u = Math.floor(i / 2);
    const side = i % 2;
    const per = layout.unitsPerRow;
    const ux = left + (u % per) * UNIT_W;
    const uy = z.y + LABEL_H + COUNTER_H + Math.floor(u / per) * slotH;
    const spot = SPOT.kitchen[side];
    t.set(a.id, {
      mx: ux + spot.x,
      my: uy + spot.y,
      rect: slotRect(layout, ux + side * SLOT_W, uy),
      plateTop: SLOT_TOP,
    });
  });
  groups.exit.forEach((a, i) => {
    const z = zones.exit;
    const per = layout.exitPerRow;
    const sx = z.x + ZPAD + (i % per) * SLOT_W;
    const sy = z.y + LABEL_H + Math.floor(i / per) * slotH;
    t.set(a.id, { mx: sx + SPOT.exit.x, my: sy + SPOT.exit.y, rect: slotRect(layout, sx, sy), plateTop: SLOT_TOP });
  });
  return t;
}

// --- Navegación entre zonas (para no cruzar los tabiques) ----------------------
const GAP = 14; // tamaño del paso en cada tabique (debe casar con drawFloors)

/** Zonas con su nombre, para recorrerlas en orden. */
function zoneList(layout) {
  return ZONE_ORDER.map((name) => ({ name, ...layout.zones[name] }));
}

/** Zona que contiene (o más cerca queda de) un punto. */
export function zoneAt(layout, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const name of ZONE_ORDER) {
    const z = layout.zones[name];
    const dx = Math.max(z.x - x, 0, x - (z.x + z.w));
    const dy = Math.max(z.y - y, 0, y - (z.y + z.h));
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = name;
      if (d === 0) break;
    }
  }
  return best;
}

/**
 * Centros de los huecos que comunican cada par de zonas vecinas. Cada uno es un
 * punto de paso para cruzar de una zona a otra sin atravesar el tabique.
 */
export function portals(layout) {
  const zs = zoneList(layout);
  const out = [];
  for (const z of zs) {
    // Tabique vertical a su izquierda (paso centrado en vertical).
    if (z.x > 0) {
      const w = zs.find((o) => o.name !== z.name && Math.abs(o.x + o.w - z.x) < 1 && o.y < z.y + z.h && z.y < o.y + o.h);
      if (w) out.push({ a: w.name, b: z.name, x: z.x, y: gapCenterY(z) });
    }
    // Tabique horizontal encima (paso centrado en horizontal).
    if (z.y > WALL_H) {
      const w = zs.find((o) => o.name !== z.name && Math.abs(o.y + o.h - z.y) < 1 && o.x < z.x + z.w && z.x < o.x + o.w);
      if (w) out.push({ a: w.name, b: z.name, x: gapCenterX(z), y: z.y });
    }
  }
  return out;
}

const gapCenterX = (z) => z.x + Math.floor(z.w / 2);
const gapCenterY = (z) => z.y + Math.floor(z.h / 2);

/**
 * Puntos intermedios (por los huecos) para ir de `from` a `to` sin cruzar
 * tabiques. Lista vacía si ya están en la misma zona (recta) o no hay ruta.
 * Entre las rutas posibles elige la más corta en distancia.
 */
export function route(layout, from, to) {
  const fromZone = zoneAt(layout, from.x, from.y);
  const toZone = zoneAt(layout, to.x, to.y);
  if (fromZone === toZone) return [];
  const adj = new Map(ZONE_ORDER.map((z) => [z, []]));
  for (const p of portals(layout)) {
    adj.get(p.a).push({ to: p.b, x: p.x, y: p.y });
    adj.get(p.b).push({ to: p.a, x: p.x, y: p.y });
  }
  let best = null;
  const walk = (zone, seen, pts) => {
    if (zone === toZone) {
      const len = polylineLength([from, ...pts, to]);
      if (!best || len < best.len) best = { len, pts };
      return;
    }
    for (const e of adj.get(zone) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      walk(e.to, seen, [...pts, { x: e.x, y: e.y }]);
      seen.delete(e.to);
    }
  };
  walk(fromZone, new Set([fromZone]), []);
  return best ? best.pts : [];
}

/** Longitud total de una polilínea. */
export function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

/** Punto a `dist` de recorrido sobre una polilínea. */
export function pointAlong(pts, dist) {
  if (!pts.length) return { x: 0, y: 0 };
  let left = Math.max(0, dist);
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const seg = Math.hypot(dx, dy);
    if (left <= seg || i === pts.length - 1) {
      const f = seg === 0 ? 0 : Math.min(1, left / seg);
      return { x: pts[i - 1].x + dx * f, y: pts[i - 1].y + dy * f };
    }
    left -= seg;
  }
  return { ...pts[pts.length - 1] };
}

/** Signo de la componente horizontal del tramo en el que cae `dist` (-1, 0, 1). */
export function headingAlong(pts, dist) {
  let left = Math.max(0, dist);
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const seg = Math.hypot(dx, pts[i].y - pts[i - 1].y);
    if (left < seg || i === pts.length - 1) return Math.sign(dx);
    left -= seg;
  }
  return 0;
}

/**
 * Aparta a los que caminan para que no se pisen; los quietos no se mueven.
 * `items`: `[{ id, x, y, movable }]`. Devuelve `id -> { x, y }` de los movibles.
 */
export function separate(items, minDist, passes = 3) {
  const pts = items.map((it) => ({ ...it }));
  for (let k = 0; k < passes; k++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        if (!a.movable && !b.movable) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-6) {
          dx = a.id < b.id ? 1 : -1; // justo encima: dirección estable por id
          dy = 0;
          d = 1;
        }
        const ux = dx / d;
        const uy = dy / d;
        const push = (minDist - d) / 2;
        if (a.movable && b.movable) {
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        } else if (a.movable) {
          a.x -= ux * push * 2;
          a.y -= uy * push * 2;
        } else {
          b.x += ux * push * 2;
          b.y += uy * push * 2;
        }
      }
    }
  }
  const out = new Map();
  for (const it of pts) if (it.movable) out.set(it.id, { x: it.x, y: it.y });
  return out;
}
