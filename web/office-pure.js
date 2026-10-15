// Lógica pura de la Oficina: asignación de lugares, agrupación por zona y
// utilidades de texto/escala. Sin DOM ni canvas, para poder probarla sola.
// (La vista y el dibujo viven en office.js.)

/** Zona de la oficina en la que se ve a un agente según su estado. */
export const ZONE_OF = {
  working: "office",
  error: "office",
  disconnected: "office",
  waiting_input: "queue",
  waiting_approval: "queue",
  idle: "kitchen",
  exited: "exit",
};

/** Escala entera mínima según el ancho (por debajo, todo se vería diminuto). */
export function pickScale(cssWidth) {
  if (cssWidth >= 1300) return 4;
  if (cssWidth >= 820) return 3;
  return 2;
}

/**
 * Escritorio estable para cada agente: el que ya tenía (por nombre) si está
 * libre; si no, el primer hueco. Devuelve id -> escritorio y nombre -> escritorio.
 */
export function assignSeats(agents, saved) {
  const seats = { ...saved };
  const taken = new Map();
  const result = new Map();
  for (const a of agents) {
    const s = seats[a.name];
    if (Number.isInteger(s) && !taken.has(s)) {
      taken.set(s, a.id);
      result.set(a.id, s);
    }
  }
  for (const a of agents) {
    if (result.has(a.id)) continue;
    let s = 0;
    while (taken.has(s)) s++;
    taken.set(s, a.id);
    result.set(a.id, s);
    seats[a.name] = s;
  }
  return { result, seats };
}

/** Las líneas de la pantalla, en miniatura: qué columnas tienen texto. */
export function miniLine(text, width, charsPerPx = 3.6) {
  const out = new Array(width).fill(false);
  for (let px = 0; px < width; px++) {
    const from = Math.floor(px * charsPerPx);
    const to = Math.floor((px + 1) * charsPerPx);
    for (let i = from; i < to && i < text.length; i++) {
      if (text[i] !== " ") {
        out[px] = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Destino de una tecla de navegación dentro de un grupo de escritorios (ids en
 * orden de prioridad), sabiendo cuál tiene el foco. `null` si no aplica.
 */
export function nextDesk(order, currentId, key) {
  if (!order.length) return null;
  const i = order.indexOf(currentId);
  if (key === "Home") return order[0];
  if (key === "End") return order[order.length - 1];
  if (key === "ArrowDown" || key === "ArrowRight") return order[i < 0 ? 0 : i + 1] ?? null;
  if (key === "ArrowUp" || key === "ArrowLeft") return order[i < 0 ? order.length - 1 : i - 1] ?? null;
  return null;
}

/** Quién va a cada lugar, en orden: la fila, por orden de llegada. */
export function groupByZone(agents, seatOf) {
  const groups = { queue: [], office: [], kitchen: [], exit: [] };
  for (const a of agents) groups[ZONE_OF[a.state] ?? "office"].push(a);
  // `state_since` se parsea una sola vez por agente (antes: 2 veces por comparación).
  const since = new Map(agents.map((a) => [a.id, Date.parse(a.state_since) || 0]));
  const bySince = (p, q) => since.get(p.id) - since.get(q.id) || p.name.localeCompare(q.name);
  groups.queue.sort(bySince);
  groups.exit.sort(bySince);
  groups.kitchen.sort((p, q) => seatOf.get(p.id) - seatOf.get(q.id));
  return groups;
}
