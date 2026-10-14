// Consumo sin DOM: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { chipsOf, formatRemaining, levelOf, resetText, shortLabel } from "../../web/usage.js";

test("el nivel: ok, atención desde 75 % y alto desde 90 %", () => {
  assert.deepEqual([0, 74.9, 75, 89.9, 90, 100].map(levelOf), ["ok", "ok", "warn", "warn", "high", "high"]);
});

test("las etiquetas largas se acortan", () => {
  assert.equal(shortLabel("Gemini Models"), "Gemini");
  assert.equal(shortLabel("Claude and GPT models"), "Claude and GPT");
  assert.equal(shortLabel("Opus"), "Opus");
  assert.equal(shortLabel(undefined), "");
});

test("el tiempo que falta se dice corto", () => {
  const m = 60000;
  assert.equal(formatRemaining(12 * m), "12 min");
  assert.equal(formatRemaining(5 * 60 * m + 10 * m), "5 h 10 min");
  assert.equal(formatRemaining(3 * 60 * m), "3 h");
  assert.equal(formatRemaining(2 * 1440 * m + 3 * 60 * m), "2 d 3 h");
  assert.equal(formatRemaining(-5), "0 min");
});

test("el reinicio: una fecha ISO se cuenta desde ahora; un texto del agente pasa tal cual", () => {
  const now = Date.parse("2026-10-14T20:00:00Z");
  assert.match(resetText("2026-10-14T23:30:00Z", now), /3 h 30 min/);
  assert.match(resetText("Oct 19, 11:59am (America/Santiago)", now), /Oct 19, 11:59am \(America\/Santiago\)/);
  assert.equal(resetText(undefined, now), "");
});

test("el informe del servidor se convierte en fichas con nivel, etiquetas y datos sueltos", () => {
  const now = Date.parse("2026-10-14T20:00:00Z");
  const chips = chipsOf(
    {
      at: "2026-10-14T20:00:00Z",
      agents: [
        { kind: "claude", meters: [{ id: "session", used_pct: 34.4 }, { id: "week", label: "Opus", used_pct: 91, resets: "2026-10-16T20:00:00Z" }], facts: [] },
        { kind: "opencode", meters: [], facts: [{ id: "cost", value: "$1.33" }] },
        { kind: "agy", meters: [], facts: [], error: "timeout" },
      ],
    },
    now,
  );
  assert.equal(chips.length, 3);
  assert.equal(chips[0].name, "Claude Code");
  assert.deepEqual(chips[0].meters.map((m) => [m.id, m.pct, m.level, m.extra]), [["session", 34, "ok", ""], ["week", 91, "high", "Opus"]]);
  assert.match(chips[0].meters[1].reset, /2 d/);
  assert.deepEqual(chips[1].facts.map((f) => [f.id, f.value]), [["cost", "$1.33"]]);
  assert.ok(chips[2].error.length > 0);
  assert.deepEqual(chipsOf(null), []);
});
