// Prueba de humo del renderizador de la Oficina: monta un DOM falso mínimo,
// crea el renderizador, le da agentes y comprueba que dibuja sin romperse y que
// la capa estática (pared, reloj, emblema…) no se repinta en cada frame.
import { test } from "node:test";
import assert from "node:assert/strict";

const rec = { fills: 0, draws: 0 };

function makeCtx() {
  return {
    fillStyle: "",
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillRect() {
      rec.fills++;
    },
    drawImage() {
      rec.draws++;
    },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
  };
}

function makeEl(tag = "div") {
  const el = {
    tagName: tag,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
    dataset: {},
    className: "",
    title: "",
    width: 1200,
    height: 800,
    clientWidth: 1200,
    children: [],
    parentNode: null,
    _html: "",
    _q: new Map(),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _rect: { top: 0, left: 0, width: 1200, height: 800 },
    _attrs: new Map(),
    setAttribute(k, v) {
      el._attrs.set(k, v);
    },
    getAttribute: (k) => (el._attrs.has(k) ? el._attrs.get(k) : null),
    removeAttribute(k) {
      el._attrs.delete(k);
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) {
      if (c.parentNode) c.parentNode.children = c.parentNode.children.filter((x) => x !== c);
      c.parentNode = el;
      el.children.push(c);
      return c;
    },
    append(...cs) {
      for (const c of cs) {
        if (c.parentNode) c.parentNode.children = c.parentNode.children.filter((x) => x !== c);
        c.parentNode = el;
        el.children.push(c);
      }
    },
    remove() {
      if (el.parentNode) {
        el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
        el.parentNode = null;
      }
    },
    querySelector(sel) {
      if (!el._q.has(sel)) {
        const child = makeEl("span");
        child.parentNode = el;
        el._q.set(sel, child);
      }
      return el._q.get(sel);
    },
    querySelectorAll: () => [],
    contains: () => false,
    focus() {},
    blur() {},
    scrollIntoView() {},
    click() {},
    getBoundingClientRect: () => el._rect,
    getContext: () => makeCtx(),
  };
  Object.defineProperty(el, "innerHTML", {
    get: () => el._html,
    set: (v) => {
      el._html = v;
    },
  });
  return el;
}

function installDom() {
  const documentElement = makeEl();
  documentElement.dataset = {};
  globalThis.document = {
    documentElement,
    body: makeEl("body"),
    activeElement: null,
    fonts: { load: () => Promise.resolve() },
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  const mm = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.window = {
    matchMedia: mm,
    devicePixelRatio: 1,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.matchMedia = mm;
  globalThis.requestAnimationFrame = () => 0; // no reanuda el bucle de dibujo
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  // Nada de temporizadores reales: el runner no debe quedarse colgado.
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
}

installDom();
const { createOfficeRenderer } = await import("../../web/office.js");

function agent(id, state, extra = {}) {
  return {
    id,
    name: id,
    state,
    kind: "generic",
    project: "argos",
    state_since: new Date().toISOString(),
    last_lines: ["$ echo hola", "hola"],
    ...extra,
  };
}

function makePrefs() {
  let seats = {};
  return {
    isDismissed: () => false,
    seats: () => seats,
    setSeats: (v) => {
      seats = v;
    },
  };
}

function makeRenderer() {
  const root = makeEl();
  const office = createOfficeRenderer({ root, prefs: makePrefs(), onOpen() {} });
  return { office, root };
}

function snapshot(...agents) {
  return { agents: new Map(agents.map((a) => [a.id, a])), change: { kind: "snapshot" } };
}

test("con la Oficina oculta, render no dibuja nada", () => {
  const { office } = makeRenderer();
  office.setActive(false);
  const before = rec.fills;
  office.render(snapshot(agent("a1", "working"), agent("a2", "idle")));
  office.render(snapshot(agent("a1", "working")));
  assert.equal(rec.fills, before, "no debería pintar mientras está oculta");
});

test("al mostrarse dibuja y la capa estática se cachea entre frames", () => {
  const { office } = makeRenderer();
  office.render(snapshot(agent("b1", "working"), agent("b2", "idle"), agent("b3", "waiting_input")));

  rec.fills = 0;
  office.setActive(true); // primer volcado: construye la capa estática (más caro)
  const firstCost = rec.fills;
  assert.ok(firstCost > 0, "debería pintar al mostrarse");

  rec.fills = 0;
  office.render({
    agents: new Map([
      ["b1", agent("b1", "working")],
      ["b2", agent("b2", "idle")],
      ["b3", agent("b3", "waiting_input")],
    ]),
    change: { kind: "agent_updated", agent: { id: "b1" } },
  });
  const frameCost = rec.fills;
  assert.ok(frameCost > 0, "un frame normal dibuja");
  assert.ok(frameCost < firstCost, `un frame normal (${frameCost}) cuesta menos que el montaje (${firstCost})`);
});

test("no se rompe con agentes en todos los estados", () => {
  const { office } = makeRenderer();
  const all = ["working", "idle", "waiting_input", "waiting_approval", "error", "disconnected", "exited"].map((s, i) =>
    agent(`s${i}`, s),
  );
  office.setActive(true);
  assert.doesNotThrow(() => office.render(snapshot(...all)));
});

/** El contenedor `.desks` con sus grupos de zona. */
function zoneGroups(root) {
  const desks = root.children[0].children.find((c) => c.className === "desks");
  const byZone = {};
  for (const g of desks.children) byZone[g.className.replace("desk-zone desk-zone-", "")] = g;
  return byZone;
}

test("cada escritorio vive en el grupo de su zona", () => {
  const { office, root } = makeRenderer();
  office.setActive(true);
  office.render(
    snapshot(agent("q1", "waiting_input"), agent("o1", "working"), agent("k1", "idle"), agent("e1", "exited")),
  );

  const zones = zoneGroups(root);
  assert.deepEqual(Object.keys(zones).sort(), ["exit", "kitchen", "office", "queue"], "un grupo por zona");
  for (const g of Object.values(zones)) {
    assert.equal(g.getAttribute("role"), "group", "cada zona es un role=group");
    assert.ok(g.getAttribute("aria-label"), "cada zona tiene nombre accesible");
  }
  const ids = (z) => zones[z].children.map((b) => b.dataset.id);
  assert.deepEqual(ids("queue"), ["q1"]);
  assert.deepEqual(ids("office"), ["o1"]);
  assert.deepEqual(ids("kitchen"), ["k1"]);
  assert.deepEqual(ids("exit"), ["e1"]);
});

test("un agente cambia de grupo solo al cambiar de zona", () => {
  const { office, root } = makeRenderer();
  office.setActive(true);
  office.render(snapshot(agent("o1", "working"), agent("o2", "idle")));

  office.render({
    agents: new Map([
      ["o1", agent("o1", "waiting_input")], // pasa a la cola
      ["o2", agent("o2", "idle")], // se queda igual
    ]),
    change: { kind: "agent_updated", agent: { id: "o1" } },
  });

  const zones = zoneGroups(root);
  assert.deepEqual(zones.queue.children.map((b) => b.dataset.id), ["o1"]);
  assert.deepEqual(zones.kitchen.children.map((b) => b.dataset.id), ["o2"]);
  assert.equal(zones.office.children.length, 0, "el grupo viejo queda vacío");
});
