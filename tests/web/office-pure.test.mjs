// Pruebas de la lógica pura de la Oficina (sin DOM ni canvas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ZONE_OF, ZONE_ORDER, pickScale, assignSeats, miniLine, groupByZone, nextDesk } from "../../web/office-pure.js";

test("ZONE_OF: cada estado cae en su lugar", () => {
  assert.deepEqual(ZONE_OF.working, "office");
  assert.deepEqual(ZONE_OF.error, "office");
  assert.deepEqual(ZONE_OF.disconnected, "office");
  assert.deepEqual(ZONE_OF.waiting_input, "queue");
  assert.deepEqual(ZONE_OF.waiting_approval, "queue");
  assert.deepEqual(ZONE_OF.idle, "kitchen");
  assert.deepEqual(ZONE_OF.exited, "exit");
});

test("ZONE_ORDER: orden canónico de las zonas", () => {
  assert.deepEqual(ZONE_ORDER, ["queue", "office", "kitchen", "exit"]);
  for (const zone of Object.values(ZONE_OF)) assert.ok(ZONE_ORDER.includes(zone), `${zone} está en el orden`);
});

test("pickScale: escala entera según el ancho", () => {
  assert.equal(pickScale(2000), 4);
  assert.equal(pickScale(1300), 4);
  assert.equal(pickScale(1299), 3);
  assert.equal(pickScale(820), 3);
  assert.equal(pickScale(819), 2);
  assert.equal(pickScale(0), 2);
});

test("assignSeats: sin lugares guardados, reparte en orden desde 0", () => {
  const agents = [{ id: "a", name: "Ana" }, { id: "b", name: "Bea" }];
  const { result, seats } = assignSeats(agents, {});
  assert.equal(result.get("a"), 0);
  assert.equal(result.get("b"), 1);
  assert.deepEqual(seats, { Ana: 0, Bea: 1 });
});

test("assignSeats: respeta el lugar ya guardado por nombre", () => {
  const agents = [{ id: "a", name: "Ana" }, { id: "b", name: "Bea" }];
  const { result } = assignSeats(agents, { Bea: 5 });
  assert.equal(result.get("b"), 5);
  // Ana no tenía: coge el primer hueco libre (el 0, que no está ocupado).
  assert.equal(result.get("a"), 0);
});

test("assignSeats: ante colisión gana el primero de la lista y el otro coge el hueco", () => {
  const agents = [{ id: "a", name: "Ana" }, { id: "b", name: "Bea" }];
  const { result } = assignSeats(agents, { Ana: 2, Bea: 2 });
  assert.equal(result.get("a"), 2);
  assert.equal(result.get("b"), 0);
});

test("assignSeats: rellena los huecos bajos, no salta al final", () => {
  const agents = [{ id: "c", name: "C" }, { id: "a", name: "A" }, { id: "b", name: "B" }];
  const { result } = assignSeats(agents, { A: 0, B: 1 });
  assert.equal(result.get("c"), 2);
});

test("assignSeats: ignora un lugar guardado que no es entero", () => {
  const agents = [{ id: "a", name: "Ana" }];
  const { result } = assignSeats(agents, { Ana: "3" });
  assert.equal(result.get("a"), 0);
});

test("assignSeats: conserva los lugares de nombres que ya no están", () => {
  const { seats } = assignSeats([{ id: "a", name: "Ana" }], { Viejo: 4 });
  assert.equal(seats.Viejo, 4);
});

test("miniLine: una columna se enciende si tiene texto", () => {
  assert.deepEqual(miniLine("ab", 2, 1), [true, true]);
  assert.deepEqual(miniLine("  ", 2, 1), [false, false]);
  assert.deepEqual(miniLine("a b", 3, 1), [true, false, true]);
});

test("miniLine: no se pasa del ancho pedido", () => {
  const line = miniLine("xxxxxxxxxx", 3, 1);
  assert.equal(line.length, 3);
  assert.deepEqual(line, [true, true, true]);
});

test("miniLine: con el paso por defecto agrupa ~3.6 caracteres por columna", () => {
  // "hola" (4 letras) -> 2 columnas con 3.6 chars/px cubren hasta el índice 7.
  assert.deepEqual(miniLine("hola", 2), [true, true]);
  // Espacio inicial: la primera columna (índices 0..3) ve " h" -> hay texto.
  assert.deepEqual(miniLine("   a", 2), [false, true]);
});

function agent(id, state, since, name = id) {
  return { id, name, state, state_since: since };
}

test("groupByZone: reparte por estado y lo desconocido va a la oficina", () => {
  const a = agent("1", "working", "2024-01-01T00:00:00Z");
  const b = agent("2", "waiting_input", "2024-01-01T00:00:00Z");
  const c = agent("3", "idle", "2024-01-01T00:00:00Z");
  const d = agent("4", "exited", "2024-01-01T00:00:00Z");
  const e = agent("5", "vaya_estado_raro", "2024-01-01T00:00:00Z");
  const g = groupByZone([a, b, c, d, e], new Map());
  assert.deepEqual(g.office.map((x) => x.id), ["1", "5"]);
  assert.deepEqual(g.queue.map((x) => x.id), ["2"]);
  assert.deepEqual(g.kitchen.map((x) => x.id), ["3"]);
  assert.deepEqual(g.exit.map((x) => x.id), ["4"]);
});

test("groupByZone: la fila y la salida van por orden de llegada, con nombre como desempate", () => {
  const q1 = agent("q1", "waiting_input", "2024-01-01T00:00:10Z");
  const q2 = agent("q2", "waiting_approval", "2024-01-01T00:00:05Z");
  const q3 = agent("q3", "waiting_input", "2024-01-01T00:00:05Z", "Zoe");
  const q4 = agent("q4", "waiting_input", "2024-01-01T00:00:05Z", "Ana");
  const g = groupByZone([q1, q2, q3, q4], new Map());
  // q2, q4 (Ana) y q3 (Zoe) empatan en tiempo: desempate alfabético -> Ana, q2, Zoe.
  assert.deepEqual(g.queue.map((x) => x.id), ["q4", "q2", "q3", "q1"]);
});

test("groupByZone: la cocina se ordena por escritorio", () => {
  const k1 = agent("k1", "idle", "2024-01-01T00:00:00Z");
  const k2 = agent("k2", "idle", "2024-01-01T00:00:00Z");
  const k3 = agent("k3", "idle", "2024-01-01T00:00:00Z");
  const seatOf = new Map([["k1", 2], ["k2", 0], ["k3", 1]]);
  const g = groupByZone([k1, k2, k3], seatOf);
  assert.deepEqual(g.kitchen.map((x) => x.id), ["k2", "k3", "k1"]);
});

test("groupByZone: la oficina conserva el orden de entrada", () => {
  const o1 = agent("o1", "working", "2024-01-01T00:00:00Z");
  const o2 = agent("o2", "error", "2024-01-01T00:00:00Z");
  const g = groupByZone([o1, o2], new Map());
  assert.deepEqual(g.office.map((x) => x.id), ["o1", "o2"]);
});

test("nextDesk: flechas avanzan y retroceden por el orden", () => {
  const order = ["a", "b", "c"];
  assert.equal(nextDesk(order, "a", "ArrowDown"), "b");
  assert.equal(nextDesk(order, "a", "ArrowRight"), "b");
  assert.equal(nextDesk(order, "b", "ArrowUp"), "a");
  assert.equal(nextDesk(order, "b", "ArrowLeft"), "a");
});

test("nextDesk: Home y End van a los extremos", () => {
  const order = ["a", "b", "c"];
  assert.equal(nextDesk(order, "b", "Home"), "a");
  assert.equal(nextDesk(order, "b", "End"), "c");
});

test("nextDesk: sin foco entra por el principio (abajo) o el final (arriba)", () => {
  const order = ["a", "b", "c"];
  assert.equal(nextDesk(order, null, "ArrowDown"), "a");
  assert.equal(nextDesk(order, null, "ArrowUp"), "c");
});

test("nextDesk: no se pasa de los extremos y solo reacciona a las flechas", () => {
  const order = ["a", "b"];
  assert.equal(nextDesk(order, "b", "ArrowDown"), null);
  assert.equal(nextDesk(order, "a", "ArrowUp"), null);
  assert.equal(nextDesk(order, "a", "Enter"), null);
  assert.equal(nextDesk([], "a", "ArrowDown"), null);
});
