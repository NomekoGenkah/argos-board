// Pruebas de los datos compartidos de agentes (sin DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LABELS, KINDS, formatDuration, sortAgents } from "../../web/agents.js";

test("LABELS cubre todos los estados conocidos", () => {
  for (const s of ["working", "waiting_input", "waiting_approval", "idle", "error", "exited", "disconnected"]) {
    assert.equal(typeof LABELS[s], "string");
    assert.ok(LABELS[s].length > 0);
  }
});

test("KINDS se reexporta desde kinds.js", () => {
  assert.equal(typeof KINDS, "object");
});

test("formatDuration: segundos, minutos y horas", () => {
  assert.equal(formatDuration(0), "0 s");
  assert.equal(formatDuration(59_000), "59 s");
  assert.equal(formatDuration(60_000), "1 min 0 s");
  assert.equal(formatDuration(90_000), "1 min 30 s");
  assert.equal(formatDuration(3_600_000), "1 h 0 min");
  assert.equal(formatDuration(3_900_000), "1 h 5 min");
});

test("formatDuration: nunca negativo y redondea a la baja", () => {
  assert.equal(formatDuration(-500), "0 s");
  assert.equal(formatDuration(1_999), "1 s");
});

test("sortAgents: ordena por prioridad de estado y desempata por nombre", () => {
  const list = [
    { name: "Zoe", state: "idle" },
    { name: "Ana", state: "working" },
    { name: "Bea", state: "waiting_input" },
    { name: "Carla", state: "idle" },
  ];
  assert.deepEqual(
    sortAgents(list).map((a) => a.name),
    ["Bea", "Ana", "Carla", "Zoe"], // waiting_input, working, luego idle por nombre
  );
});

test("sortAgents: no muta la lista original", () => {
  const list = [
    { name: "Zoe", state: "idle" },
    { name: "Bea", state: "waiting_input" },
  ];
  const copy = [...list];
  sortAgents(list);
  assert.deepEqual(list, copy);
});
