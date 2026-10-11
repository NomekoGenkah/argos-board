// Vista OFICINA (pixel-art). Otro consumidor de la capa de datos: cada agente
// es una mascota y el lugar donde está cuenta su estado de un vistazo:
//   Oficina     → trabajando, con error o desconectado (en su escritorio)
//   Te esperan  → te hizo una pregunta o pide permiso (fila frente a tu escritorio)
//   Cocina      → inactivo (café)
//   Salida      → terminó
// Cuando cambia de estado, camina de un lugar a otro. El canvas es decorado
// (aria-hidden); lo interactivo y accesible son botones HTML encima de cada agente.

import * as S from "./sprites.js";
import { LABELS, KINDS, formatDuration, sortAgents } from "./render.js";

export const ZONE_OF = {
  working: "office",
  error: "office",
  disconnected: "office",
  waiting_input: "queue",
  waiting_approval: "queue",
  idle: "kitchen",
  exited: "exit",
};
const ZONE_TITLE = { queue: "TE ESPERAN", office: "OFICINA", kitchen: "COCINA", exit: "SALIDA" };

const POD_W = 56; // escritorio
const POD_H = 42;
const SLOT_W = 38; // lugar de una mascota en la fila, la cocina o la salida
const SLOT_TOP = 30; // alto del lugar sin la placa
const UNIT_W = 76; // mesa de la cocina con dos taburetes
const COUNTER_H = 22;
const YOUR_DESK_W = 56;
const DOOR_W = 30;
const WALL_H = 44;
const ZPAD = 5;
const LABEL_H = 14;
const PLATE_PX = 40; // alto de la placa HTML, en px de pantalla
const FRAME_MS = 120;
const SPEED = 75; // px de escena por segundo al caminar
// En las placas, una etiqueta corta (la completa va en el aria-label y el tooltip).
const SHORT = { waiting_input: "Pregunta", waiting_approval: "Permiso" };

const SCENE = {
  light: {
    wall: "#f1e6dd",
    wallShade: "#e6d6c9",
    panel: "#dcc6b6",
    panelLine: "#cfb6a4",
    base: "#593c37",
    partition: "#e9ddd3",
    partitionTop: "#fbf6f2",
    plank: ["#dbb68d", "#d6b087", "#cfa67b"],
    seam: "#c39b70",
    carpet: ["#efd9cf", "#e8cdc1"],
    rug: "#c9553f",
    rugBorder: "#a8432f",
    tile: ["#f4f1ec", "#dfe8ea"],
    concrete: ["#d9d3ce", "#cfc8c2"],
    frame: "#ffffff",
    frameShade: "#d9cfc9",
    deskTop: "#c48a5c",
    deskTopHi: "#d39d70",
    deskFront: "#9b6542",
    deskFrontDark: "#7f5034",
    counterTop: "#e8e4df",
    counterFront: "#b98e6a",
    shadow: "rgb(89 60 55 / .16)",
    plaque: "#593c37",
    plaqueIn: "#f8f1ec",
    signText: "#ffffff",
    muted: "#a48f88",
    iris: "#318561",
    glow: 0,
  },
  dark: {
    wall: "#2d2422",
    wallShade: "#261e1c",
    panel: "#3a2e2b",
    panelLine: "#33282a",
    base: "#1a1311",
    partition: "#4a3b37",
    partitionTop: "#5d4b46",
    plank: ["#43312a", "#3f2e27", "#4c382e"],
    seam: "#33251f",
    carpet: ["#3a2a2a", "#352626"],
    rug: "#6e2c22",
    rugBorder: "#57221a",
    tile: ["#30363a", "#283033"],
    concrete: ["#37322f", "#322d2a"],
    frame: "#5a4a45",
    frameShade: "#433733",
    deskTop: "#7a5238",
    deskTopHi: "#8a5f42",
    deskFront: "#5c3c29",
    deskFrontDark: "#472d1f",
    counterTop: "#5b5652",
    counterFront: "#5c3c29",
    shadow: "rgb(0 0 0 / .3)",
    plaque: "#1a1311",
    plaqueIn: "#3a2f2c",
    signText: "#f6eeec",
    muted: "#8a7a75",
    iris: "#1ad988",
    glow: 1,
  },
};

const EYE = [
  ".....ooooooo.....",
  "...ooWWWWWWWoo...",
  ".ooWWWWWWWWWWWoo.",
  "oWWWWWWWWWWWWWWWo",
  "oWWWWWWWWWWWWWWWo",
  "oWWWWWWWWWWWWWWWo",
  ".ooWWWWWWWWWWWoo.",
  "...ooWWWWWWWoo...",
  ".....ooooooo.....",
];

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

/** Quién va a cada lugar, en orden: la fila, por orden de llegada. */
export function groupByZone(agents, seatOf) {
  const groups = { queue: [], office: [], kitchen: [], exit: [] };
  for (const a of agents) groups[ZONE_OF[a.state] ?? "office"].push(a);
  const bySince = (p, q) => Date.parse(p.state_since) - Date.parse(q.state_since) || p.name.localeCompare(q.name);
  groups.queue.sort(bySince);
  groups.exit.sort(bySince);
  groups.kitchen.sort((p, q) => seatOf.get(p.id) - seatOf.get(q.id));
  return groups;
}

export function createOfficeRenderer({ root, prefs, onOpen }) {
  const stage = document.createElement("div");
  stage.className = "office-stage";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const tags = document.createElement("div");
  tags.className = "desk-tags";
  tags.setAttribute("aria-hidden", "true");
  const desks = document.createElement("div");
  desks.className = "desks";
  stage.append(canvas, tags, desks);
  root.append(stage);
  const ctx = canvas.getContext("2d");
  const bg = document.createElement("canvas"); // pisos y tabiques (cambian poco)
  let bgKey = "";

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let agents = new Map();
  let visible = [];
  let seatOf = new Map();
  let groups = { queue: [], office: [], kitchen: [], exit: [] };
  const buttons = new Map(); // id -> botón
  const deskTags = new Map(); // id -> etiqueta del escritorio de quien anda en otro lugar
  const pos = new Map(); // id -> posición actual de la mascota
  let targets = new Map(); // id -> { zone, mx, my, rect, plateTop }
  let layout = null;
  let layoutKey = "";
  let moved = false; // el próximo cambio de lugar viene de un cambio de estado (se camina)
  let active = false;
  let loop = null;
  let sawSnapshot = false;
  let lastTime = performance.now();

  // --- Geometría -------------------------------------------------------------
  /**
   * Los píxeles más grandes con los que la oficina entra en la pantalla; si no
   * entra con ninguno, la escala según el ancho (y se hace scroll).
   */
  function computeLayout() {
    const cssW = root.clientWidth || 1;
    const availH = Math.max(360, window.innerHeight - root.getBoundingClientRect().top - 24);
    const byWidth = pickScale(cssW);
    for (const scale of [4, 3]) {
      if (scale < byWidth - 1 || cssW / scale < 150) continue;
      const l = layoutAt(scale, cssW);
      if (l.vh * scale <= availH) return l;
    }
    return layoutAt(byWidth, cssW);
  }

  function layoutAt(scale, cssW) {
    const vw = Math.max(150, Math.floor(cssW / scale));
    const plateV = Math.ceil(PLATE_PX / scale);
    const slotH = SLOT_TOP + plateV + 3;
    const rowH = POD_H + plateV + 5;
    const desksUsed = Math.max(1, ...[...seatOf.values()].map((s) => s + 1));
    const n = { queue: groups.queue.length, kitchen: groups.kitchen.length, exit: groups.exit.length };

    const queuePerRow = (w) => Math.max(1, Math.floor((w - 2 * ZPAD - YOUR_DESK_W) / SLOT_W));
    const exitPerRow = (w) => Math.max(1, Math.floor((w - 2 * ZPAD - DOOR_W) / SLOT_W));
    const officeCols = (w) => Math.max(1, Math.floor((w - 2 * ZPAD) / POD_W));
    const unitsPerRow = (w) => Math.max(1, Math.floor((w - 2 * ZPAD) / UNIT_W));
    const rows = (count, perRow) => Math.max(1, Math.ceil(count / perRow));
    const height = {
      queue: (w) => LABEL_H + Math.max(38, rows(n.queue, queuePerRow(w)) * slotH) + ZPAD,
      exit: (w) => LABEL_H + Math.max(34, rows(n.exit, exitPerRow(w)) * slotH) + ZPAD,
      office: (w) => LABEL_H + rows(desksUsed, officeCols(w)) * rowH + ZPAD,
      kitchen: (w) => LABEL_H + COUNTER_H + rows(Math.ceil(n.kitchen / 2), unitsPerRow(w)) * slotH + ZPAD,
    };

    const zones = {};
    const wide = vw >= 330;
    if (wide) {
      // La columna derecha (salida y cocina) crece con quienes están ahí.
      const units = Math.min(2, Math.max(1, Math.ceil(n.kitchen / 2)));
      const exitW = DOOR_W + SLOT_W * Math.min(3, Math.max(1, n.exit));
      const rw = Math.min(Math.floor(vw * 0.4), Math.max(units * UNIT_W, exitW)) + 2 * ZPAD;
      const lw = vw - rw;
      const h1 = Math.max(height.queue(lw), height.exit(rw));
      const h2 = Math.max(height.office(lw), height.kitchen(rw));
      zones.queue = { x: 0, y: WALL_H, w: lw, h: h1 };
      zones.exit = { x: lw, y: WALL_H, w: rw, h: h1 };
      zones.office = { x: 0, y: WALL_H + h1, w: lw, h: h2 };
      zones.kitchen = { x: lw, y: WALL_H + h1, w: rw, h: h2 };
    } else {
      let y = WALL_H;
      for (const z of ["queue", "office", "kitchen", "exit"]) {
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

  function podOrigin(seat) {
    const { office, rowH, zones } = layout;
    return {
      x: office.left + (seat % office.cols) * POD_W,
      y: zones.office.y + LABEL_H + Math.floor(seat / office.cols) * rowH,
    };
  }

  const slotRect = (sx, sy) => ({ x: sx, y: sy, w: SLOT_W, h: layout.slotH - 2 });

  function door() {
    const z = layout.zones.exit;
    return { x: z.x + z.w - ZPAD - 20, y: z.y + LABEL_H };
  }

  function kitchenLeft() {
    const z = layout.zones.kitchen;
    const units = Math.max(1, Math.ceil(groups.kitchen.length / 2));
    return z.x + Math.floor((z.w - Math.min(layout.unitsPerRow, units) * UNIT_W) / 2);
  }

  /** Dónde tiene que estar cada agente según su estado. */
  function computeTargets() {
    const t = new Map();
    const { zones, slotH } = layout;
    for (const a of groups.office) {
      const { x, y } = podOrigin(seatOf.get(a.id));
      t.set(a.id, { mx: x + 32, my: y + 10, rect: { x, y, w: POD_W, h: layout.rowH - 3 }, plateTop: POD_H });
    }
    groups.queue.forEach((a, i) => {
      const z = zones.queue;
      const per = layout.queuePerRow;
      const sx = z.x + ZPAD + YOUR_DESK_W + (i % per) * SLOT_W;
      const sy = z.y + LABEL_H + Math.floor(i / per) * slotH;
      t.set(a.id, { mx: sx + 11, my: sy + 14, rect: slotRect(sx, sy), plateTop: SLOT_TOP });
    });
    const left = kitchenLeft();
    groups.kitchen.forEach((a, i) => {
      const z = zones.kitchen;
      const u = Math.floor(i / 2);
      const side = i % 2;
      const per = layout.unitsPerRow;
      const ux = left + (u % per) * UNIT_W;
      const uy = z.y + LABEL_H + COUNTER_H + Math.floor(u / per) * slotH;
      const sx = ux + side * SLOT_W;
      t.set(a.id, { mx: ux + (side ? 52 : 8), my: uy + 9, rect: slotRect(sx, uy), plateTop: SLOT_TOP });
    });
    groups.exit.forEach((a, i) => {
      const z = zones.exit;
      const per = layout.exitPerRow;
      const sx = z.x + ZPAD + (i % per) * SLOT_W;
      const sy = z.y + LABEL_H + Math.floor(i / per) * slotH;
      t.set(a.id, { mx: sx + 11, my: sy + 12, rect: slotRect(sx, sy), plateTop: SLOT_TOP });
    });
    return t;
  }

  function resize() {
    layout = computeLayout();
    targets = computeTargets();
    const key = JSON.stringify([layout.vw, layout.zones]);
    // Si cambió la ventana (no un estado), nadie camina: todos aparecen en su lugar.
    if (key !== layoutKey && !moved) for (const [id, tg] of targets) pos.set(id, { x: tg.mx, y: tg.my });
    layoutKey = key;
    moved = false;
    const { scale, vw, vh } = layout;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    canvas.style.width = `${vw * scale}px`;
    canvas.style.height = `${vh * scale}px`;
    stage.style.width = `${vw * scale}px`;
    stage.style.height = `${vh * scale}px`;
    placeTags();
    draw();
  }

  // --- Botones y placas HTML --------------------------------------------------
  function createButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "desk";
    b.innerHTML =
      '<span class="plate"><span class="plate-name"></span><span class="plate-state"><span class="dot" aria-hidden="true"></span><span class="plate-text"></span></span></span>';
    b.addEventListener("click", () => onOpen?.(b.dataset.id));
    desks.append(b);
    return b;
  }

  const WHERE = { office: "en la oficina", queue: "te espera", kitchen: "en la cocina", exit: "en la salida" };

  function fillButton(b, a) {
    b.dataset.id = a.id;
    b.dataset.state = a.state;
    b.dataset.kind = a.kind;
    b.querySelector(".plate-name").textContent = a.name;
    b.setAttribute(
      "aria-label",
      `${a.name} (${KINDS[a.kind] ?? a.kind}): ${LABELS[a.state] ?? a.state}, ${WHERE[ZONE_OF[a.state] ?? "office"]}. Abrir su panel para ver su pantalla y escribirle`,
    );
  }

  /** Coloca cada botón donde está su mascota (también mientras camina). */
  function placeButtons() {
    const { scale } = layout;
    for (const a of visible) {
      const b = buttons.get(a.id);
      const tg = targets.get(a.id);
      const p = pos.get(a.id);
      if (!b || !tg || !p) continue;
      const rest = atRest(p, tg);
      const r = rest ? tg.rect : { x: p.x - 11, y: p.y - 12, w: SLOT_W, h: layout.slotH - 2 };
      const plateTop = rest ? tg.plateTop : SLOT_TOP;
      const geom = [r.x, r.y, r.w, r.h, plateTop].map((v) => Math.round(v * scale));
      const key = geom.join("|");
      if (b.dataset.geom === key) continue;
      b.dataset.geom = key;
      b.style.left = `${geom[0]}px`;
      b.style.top = `${geom[1]}px`;
      b.style.width = `${geom[2]}px`;
      b.style.height = `${geom[3]}px`;
      b.style.setProperty("--plate-top", `${geom[4]}px`);
      b.classList.toggle("compact", geom[2] < 100);
    }
  }

  /** Nombre en los escritorios cuyo dueño anda en otro lugar. */
  function placeTags() {
    const { scale } = layout;
    const away = visible.filter((a) => ZONE_OF[a.state] !== "office");
    const ids = new Set(away.map((a) => a.id));
    for (const [id, el] of deskTags) {
      if (!ids.has(id)) {
        el.remove();
        deskTags.delete(id);
      }
    }
    for (const a of away) {
      let el = deskTags.get(a.id);
      if (!el) {
        el = document.createElement("span");
        el.className = "desk-tag";
        tags.append(el);
        deskTags.set(a.id, el);
      }
      el.textContent = a.name;
      const { x, y } = podOrigin(seatOf.get(a.id));
      el.style.left = `${(x + 4) * scale}px`;
      el.style.top = `${(y + POD_H) * scale}px`;
      el.style.width = `${(POD_W - 8) * scale}px`;
    }
  }

  function tickPlates() {
    const now = Date.now();
    for (const a of visible) {
      const b = buttons.get(a.id);
      const since = formatDuration(now - Date.parse(a.state_since));
      const text = `${SHORT[a.state] ?? LABELS[a.state] ?? a.state} · ${since}`;
      const el = b.querySelector(".plate-text");
      if (el.textContent !== text) el.textContent = text;
      b.title = `${a.name} — ${LABELS[a.state] ?? a.state} desde hace ${since}\n${a.project}`;
    }
  }

  // --- Dibujo: utilidades -------------------------------------------------------
  const rect = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const frameNow = () => (reduced.matches ? 0 : Math.floor(performance.now() / FRAME_MS));
  const theme = () => (document.documentElement.dataset.theme === "dark" ? SCENE.dark : SCENE.light);
  const mascotOf = (a) => S.MASCOTS[a?.kind] ?? S.MASCOTS.generic;
  const atRest = (p, tg) => p && tg && Math.abs(p.x - tg.mx) < 0.5 && Math.abs(p.y - tg.my) < 0.5;

  const palettes = new Map();
  function mascotPalette(kind, gray) {
    const key = `${kind}|${gray}`;
    if (!palettes.has(key)) {
      const m = S.MASCOTS[kind] ?? S.MASCOTS.generic;
      let p = { o: S.OUTLINE, W: "#fbfaf7", R: "#d93619", L: "#b9b2ad", B: "#7a4f35", Y: "#f2c84b", ...m.colors };
      if (gray) p = S.grayPalette(p);
      palettes.set(key, p);
    }
    return palettes.get(key);
  }
  function plainPal(colors) {
    const key = JSON.stringify(colors);
    if (!palettes.has(key)) palettes.set(key, { o: S.OUTLINE, ...colors });
    return palettes.get(key);
  }

  /**
   * Dibuja una mascota. `o.eyes`: normal | left | up | wide | happy | x | closed | prompt.
   * `o.arms`: [izquierdo, derecho], cada uno side | up | down | none (con `o.armDy`).
   * `o.legs`: stand | walk0 | walk1 | none.
   */
  function drawMascot(a, x, y, o = {}) {
    const m = mascotOf(a);
    const pal = mascotPalette(a.kind, Boolean(o.gray));
    const body = m.body;
    const legs = o.legs ?? "stand";
    if (legs !== "none") {
      m.legs.forEach((lx, i) => {
        const lift = (legs === "walk0" && i % 2 === 0) || (legs === "walk1" && i % 2 === 1) ? 1 : 0;
        S.draw(ctx, S.LEG, x + lx - 1, y + body.h - 1 - lift, pal);
      });
    }
    const [la, ra] = o.arms ?? ["side", "side"];
    const [ldy, rdy] = o.armDy ?? [0, 0];
    const arm = (kind, right, dy) => {
      const ay = y + m.armY + dy;
      if (kind === "side") S.draw(ctx, S.ARM, right ? x + body.w - 1 : x - 2, ay, pal, right);
      else if (kind === "up") S.draw(ctx, S.ARM_UP, right ? x + body.w - 1 : x - 2, ay - 4, pal, !right);
      else if (kind === "down") S.draw(ctx, S.ARM_DOWN, right ? x + body.w - 2 : x - 1, ay + 1, pal, right);
    };
    arm(la, false, ldy);
    arm(ra, true, rdy);
    S.draw(ctx, body, x, y, pal);
    drawEyes(m, x, y, o.eyes ?? "normal", o.gray ? pal.o : m.eyeColor, a);
  }

  function drawEyes(m, x, y, style, color, a) {
    const t = frameNow();
    if (["normal", "left", "wide", "up"].includes(style) && !reduced.matches && (t + (S.hash(a.name) % 45)) % 45 === 0) {
      style = "closed"; // parpadeo
    }
    ctx.fillStyle = color;
    const px = (dx, dy, w = 1, h = 1) => ctx.fillRect(x + dx, y + dy, w, h);
    if (style === "prompt") {
      // OpenCode trabajando: la cara es un prompt ">_".
      px(4, 3);
      px(5, 4);
      px(4, 5);
      if (t % 4 < 2) px(7, 5, 4, 1);
      return;
    }
    const h = m.eyeH;
    for (const [ex, ey] of m.eyes) {
      switch (style) {
        case "left":
          px(ex - 1, ey, 1, h);
          break;
        case "up":
          px(ex, ey - 1, 1, h);
          break;
        case "wide":
          px(ex - 1, ey - 1, 2, h + 1);
          break;
        case "happy":
          px(ex - 1, ey + 1);
          px(ex, ey);
          px(ex + 1, ey + 1);
          break;
        case "x":
          px(ex - 1, ey);
          px(ex + 1, ey);
          px(ex, ey + 1);
          px(ex - 1, ey + 2);
          px(ex + 1, ey + 2);
          break;
        case "closed":
          px(ex - 1, ey + h - 1, 3, 1);
          break;
        default:
          px(ex, ey, 1, h);
      }
    }
  }

  // --- Dibujo: escena -----------------------------------------------------------
  function draw() {
    if (!layout || !active) return;
    const th = theme();
    const t = frameNow();
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastTime) / 1000);
    lastTime = now;
    const walking = stepWalkers(dt);

    ctx.imageSmoothingEnabled = false;
    drawBackground(th);
    drawWall(th, t);
    for (const z of Object.keys(layout.zones)) drawSign(th, z);
    drawQueueZone(th, t);
    drawExitZone(th, t);
    drawKitchenZone(th, t);
    drawOffice(th, t, walking);

    // Los que caminan van encima de todo.
    for (const a of visible) {
      if (!walking.has(a.id)) continue;
      const p = pos.get(a.id);
      const m = mascotOf(a);
      const step = t % 2;
      if (m.floats) floatShadow(p.x, p.y + m.body.h + 2);
      drawMascot(a, p.x, p.y - (m.floats ? (t % 4 < 2 ? 1 : 0) : step), {
        legs: step ? "walk0" : "walk1",
        armDy: [step, 1 - step],
      });
    }
    placeButtons();
  }

  function stepWalkers(dt) {
    const walking = new Set();
    for (const a of visible) {
      const tg = targets.get(a.id);
      if (!tg) continue;
      let p = pos.get(a.id);
      if (!p || reduced.matches) {
        p = { x: tg.mx, y: tg.my };
        pos.set(a.id, p);
        continue;
      }
      const dx = tg.mx - p.x;
      const dy = tg.my - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) {
        p.x = tg.mx;
        p.y = tg.my;
        continue;
      }
      const len = Math.min(d, SPEED * dt);
      p.x += (dx / d) * len;
      p.y += (dy / d) * len;
      walking.add(a.id);
    }
    return walking;
  }

  // Pisos distintos por lugar y tabiques entre ellos; se repintan solo si cambia algo.
  function drawBackground(th) {
    const key = `${layoutKey}|${th === SCENE.dark}`;
    if (key !== bgKey) {
      bgKey = key;
      bg.width = canvas.width;
      bg.height = canvas.height;
      const g = bg.getContext("2d");
      const r = (x, y, w, h, c) => {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
      };
      const { zones } = layout;
      // Oficina: tablas de madera.
      const o = zones.office;
      for (let row = 0, y = o.y; y < o.y + o.h; row++, y += 5) {
        r(o.x, y, o.w, 5, th.plank[row % 2]);
        r(o.x, y + 4, o.w, 1, th.seam);
        const off = S.hash(`fila${row}`) % 70;
        for (let x = o.x + off; x < o.x + o.w; x += 70) {
          r(x, y, 1, 4, th.seam);
          r(x + 23, y + 2, 5, 1, th.plank[2]);
        }
      }
      // Te esperan: alfombra.
      const q = zones.queue;
      r(q.x, q.y, q.w, q.h, th.carpet[0]);
      for (let y = q.y + 1; y < q.y + q.h; y += 3) {
        for (let x = q.x + (((y - q.y) / 3) % 2 ? 1 : 2); x < q.x + q.w; x += 3) r(x, y, 1, 1, th.carpet[1]);
      }
      // Cocina: baldosas.
      const k = zones.kitchen;
      for (let y = k.y; y < k.y + k.h; y += 6) {
        for (let x = k.x; x < k.x + k.w; x += 6) r(x, y, 6, 6, th.tile[((x - k.x) / 6 + (y - k.y) / 6) % 2]);
      }
      // Salida: cemento.
      const e = zones.exit;
      r(e.x, e.y, e.w, e.h, th.concrete[0]);
      for (let i = 0; i < (e.w * e.h) / 30; i++) {
        const h = S.hash(`c${i}`);
        r(e.x + (h % e.w), e.y + ((h >>> 8) % e.h), 1, 1, th.concrete[1]);
      }
      // Tabiques, con un paso en cada uno.
      for (const z of Object.values(zones)) {
        if (z.y > WALL_H) {
          const gap = z.x + Math.floor(z.w / 2) - 7;
          for (const [x0, x1] of [
            [z.x, gap],
            [gap + 14, z.x + z.w],
          ]) {
            r(x0, z.y - 1, x1 - x0, 3, th.partition);
            r(x0, z.y - 1, x1 - x0, 1, th.partitionTop);
            r(x0, z.y + 1, x1 - x0, 1, S.OUTLINE);
          }
        }
        if (z.x > 0) {
          const gapY = z.y + Math.floor(z.h / 2) - 7;
          for (const [y0, y1] of [
            [z.y, gapY],
            [gapY + 14, z.y + z.h],
          ]) {
            r(z.x - 1, y0, 3, y1 - y0, th.partition);
            r(z.x + 1, y0, 1, y1 - y0, S.OUTLINE);
          }
        }
      }
    }
    ctx.drawImage(bg, 0, 0);
  }

  function drawSign(th, zone) {
    const z = layout.zones[zone];
    let text = ZONE_TITLE[zone];
    const count = groups[zone].length;
    if (zone === "queue" && count) text += ` ${count}`;
    const hot = zone === "queue" && count > 0;
    rect(z.x + 4, z.y + 3, S.textWidth(text) + 6, 9, hot ? "#d93619" : th.plaque);
    S.drawText(ctx, text, z.x + 7, z.y + 5, th.signText);
  }

  // --- Pared --------------------------------------------------------------------
  function drawWall(th, t) {
    const { vw } = layout;
    rect(0, 0, vw, WALL_H, th.wall);
    rect(0, 0, vw, 2, th.wallShade);
    rect(0, WALL_H - 13, vw, 10, th.panel);
    for (let x = 4; x < vw; x += 12) rect(x, WALL_H - 12, 1, 8, th.panelLine);
    rect(0, WALL_H - 13, vw, 1, th.panelLine);
    rect(0, WALL_H - 3, vw, 3, th.base);

    // Una ventana, el calendario, el ojo de Argos y el reloj, centrados.
    const x0 = Math.floor((vw - 136) / 2);
    drawWindow(th, x0, 5, t);
    drawCalendar(th, x0 + 47, 7);
    drawEmblem(th, x0 + 88, t);
    drawClock(th, x0 + 125, 17);
    if (vw >= 260) {
      S.draw(ctx, S.BIG_PLANT, 2, WALL_H - 13, plantPal);
      S.draw(ctx, S.BIG_PLANT, vw - S.BIG_PLANT.w - 2, WALL_H - 13, plantPal, true);
    }
  }

  const plantPal = plainPal({ g: "#24644a", G: "#318561", T: "#994739", t: "#7d3a2f" });

  function skyFor(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 7.5 && h < 17.5) return { bands: ["#7cc3f0", "#9fd3f4", "#c4e5f8"], clouds: true };
    if (h >= 17.5 && h < 19.5) return { bands: ["#5b5aa6", "#e0796a", "#f7b267"], sun: "#ffd27a" };
    if (h >= 6 && h < 7.5) return { bands: ["#7b9ad1", "#f2a7a0", "#fbd7a8"], sun: "#fff0c2" };
    return { bands: ["#141c3a", "#1b2650", "#26346a"], stars: true };
  }

  function drawWindow(th, x, y, t) {
    const w = 38;
    const h = 26;
    const sky = skyFor(new Date());
    rect(x - 1, y - 1, w + 2, h + 2, S.OUTLINE);
    rect(x, y, w, h, th.frame);
    const ix = x + 2;
    const iy = y + 2;
    const iw = w - 4;
    const ih = h - 4;
    const band = Math.ceil(ih / 3);
    sky.bands.forEach((c, i) => rect(ix, iy + i * band, iw, Math.min(band, ih - i * band), c));
    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();
    if (sky.clouds) {
      const drift = reduced.matches ? 0 : Math.floor(performance.now() / 700);
      for (const [cx0, cy, len] of [
        [2, 4, 9],
        [20, 12, 7],
      ]) {
        const cx = ix + ((cx0 + drift) % (iw + len)) - len;
        rect(cx, iy + cy, len, 2, "#ffffff");
        rect(cx + 2, iy + cy - 1, len - 4, 1, "#ffffff");
      }
    }
    if (sky.sun) rect(ix + 22, iy + ih - 5, 5, 4, sky.sun);
    if (sky.stars) {
      [
        [3, 2],
        [12, 6],
        [24, 3],
        [8, 12],
        [28, 14],
        [17, 16],
      ].forEach(([sx, sy], i) => {
        if ((t + i * 3) % 13 !== 0) rect(ix + sx, iy + sy, 1, 1, "#fff6d8");
      });
      rect(ix + iw - 8, iy + 3, 4, 4, "#f4efd8");
      rect(ix + iw - 7, iy + 3, 3, 3, sky.bands[0]);
    }
    ctx.restore();
    rect(x + Math.floor(w / 2) - 1, y, 2, h, th.frame);
    rect(x, y + Math.floor(h / 2) - 1, w, 2, th.frame);
    rect(x - 2, y + h + 1, w + 4, 2, th.frameShade);
  }

  // Calendario: el mes en la parte roja y el día grande.
  function drawCalendar(th, x, y) {
    const w = 19;
    const now = new Date();
    rect(x - 1, y - 1, w + 2, 24, S.OUTLINE);
    rect(x, y, w, 22, "#ffffff");
    rect(x, y, w, 8, "#d93619");
    rect(x, y + 8, w, 1, "#a8291a");
    const month = S.MONTHS[now.getMonth()];
    S.drawText(ctx, month, x + Math.floor((w - S.textWidth(month)) / 2), y + 2, "#ffffff");
    const day = String(now.getDate());
    S.drawText(ctx, day, x + Math.floor((w - S.textWidth(day, 2)) / 2) + 1, y + 10, S.OUTLINE, 2);
    rect(x + 4, y - 3, 1, 4, th.base);
    rect(x + w - 5, y - 3, 1, 4, th.base);
  }

  // Reloj de pared: marco de madera, marcas de las 12 horas y segundero.
  function drawClock(th, cx, cy) {
    const r = 9;
    const disk = (radius, color, ox = 0, oy = 0) => {
      for (let y = -radius - 1; y <= radius + 1; y++) {
        for (let x = -radius - 1; x <= radius + 1; x++) {
          if (x * x + y * y <= (radius + 0.5) ** 2) rect(cx + x + ox, cy + y + oy, 1, 1, color);
        }
      }
    };
    disk(r + 1, "rgb(0 0 0 / .18)", 1, 1);
    disk(r + 1, S.OUTLINE);
    disk(r, "#8a5a3c");
    disk(r - 1, S.OUTLINE);
    disk(r - 2, "#fffdf8");
    for (let hour = 0; hour < 12; hour++) {
      const ang = (hour / 12) * Math.PI * 2;
      const at = (d) => [Math.round(Math.sin(ang) * d), -Math.round(Math.cos(ang) * d)];
      const [x1, y1] = at(r - 3);
      rect(cx + x1, cy + y1, 1, 1, hour % 3 === 0 ? S.OUTLINE : "#a99c97");
      if (hour % 3 === 0) {
        const [x2, y2] = at(r - 4);
        rect(cx + x2, cy + y2, 1, 1, S.OUTLINE);
      }
    }
    const now = new Date();
    const sec = now.getSeconds() / 60;
    const min = (now.getMinutes() + sec) / 60;
    const hr = ((now.getHours() % 12) + min) / 12;
    hand(cx, cy, hr, 3.5, S.OUTLINE);
    hand(cx, cy, min, 5.5, S.OUTLINE);
    if (!reduced.matches) hand(cx, cy, sec, 6, "#d93619");
    rect(cx, cy, 1, 1, "#d93619");
  }

  function hand(cx, cy, turn, len, color) {
    const a = turn * Math.PI * 2;
    for (let i = 0; i <= len; i += 0.5) {
      rect(cx + Math.round(Math.sin(a) * i), cy - Math.round(Math.cos(a) * i), 1, 1, color);
    }
  }

  // El emblema de Argos: un ojo que mira al primero de la fila.
  function drawEmblem(th, cx, t) {
    const x = cx - 13;
    const y = 6;
    rect(x - 1, y - 1, 28, 21, S.OUTLINE);
    rect(x, y, 26, 19, th.plaque);
    rect(x + 2, y + 2, 22, 15, th.plaqueIn);
    const ex = cx - 8;
    const ey = y + 5;
    if (!reduced.matches && t % 47 === 0) {
      rect(ex + 1, ey + 4, 15, 1, S.OUTLINE);
      return;
    }
    EYE.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === "o") rect(ex + rx, ey + ry, 1, 1, S.OUTLINE);
        else if (row[rx] === "W") rect(ex + rx, ey + ry, 1, 1, "#ffffff");
      }
    });
    const [dx, dy] = gaze(cx, t);
    const ix = ex + 8 + dx;
    const iy = ey + 4 + dy;
    for (let py = -2; py <= 2; py++) {
      for (let px = -2; px <= 2; px++) {
        if (px * px + py * py > 5) continue;
        if (EYE[iy + py - ey]?.[ix + px - ex] !== "W") continue;
        rect(ix + px, iy + py, 1, 1, px * px + py * py <= 1 ? S.OUTLINE : th.iris);
      }
    }
    if (EYE[iy - 1 - ey]?.[ix - 1 - ex] === "W") rect(ix - 1, iy - 1, 1, 1, "#ffffff");
  }

  function gaze(cx, t) {
    const pick =
      groups.queue[0] ??
      visible.find((a) => a.state === "error") ??
      (() => {
        const busy = visible.filter((a) => a.state === "working");
        return busy.length ? busy[Math.floor(t / 25) % busy.length] : null;
      })();
    const p = pick && pos.get(pick.id);
    if (!p) return [0, 1];
    const dx = Math.max(-5, Math.min(5, Math.round(((p.x + 8 - cx) / layout.vw) * 14)));
    return [dx, p.y > WALL_H + 40 ? 2 : 1];
  }

  // --- Te esperan: tu escritorio y la fila ----------------------------------------
  function drawQueueZone(th, t) {
    const z = layout.zones.queue;
    const dx = z.x + ZPAD + 2;
    const dy = z.y + LABEL_H + 2;
    // Alfombra roja y tu escritorio, vacío: tú estás mirando el tablero.
    rect(dx - 2, dy + 6, 50, 30, th.rugBorder);
    rect(dx - 1, dy + 7, 48, 28, th.rug);
    S.draw(ctx, S.CHAIR, dx + 16, dy + 2, chairPal);
    rect(dx, dy + 10, 46, 18, S.OUTLINE);
    rect(dx + 1, dy + 11, 44, 6, th.deskTop);
    rect(dx + 1, dy + 11, 44, 1, th.deskTopHi);
    rect(dx + 1, dy + 17, 44, 10, th.deskFront);
    rect(dx + 1, dy + 17, 44, 1, th.deskFrontDark);
    rect(dx + 17, dy + 19, 13, 7, th.plaqueIn);
    S.drawText(ctx, "TU", dx + 20, dy + 20, th.plaque);
    // Encima: portátil, timbre y una planta.
    rect(dx + 6, dy + 6, 14, 7, S.OUTLINE);
    rect(dx + 7, dy + 7, 12, 5, "#5a5462");
    rect(dx + 12, dy + 9, 2, 1, th.iris);
    rect(dx + 5, dy + 13, 16, 2, S.OUTLINE);
    rect(dx + 34, dy + 11, 5, 3, "#f2c84b");
    rect(dx + 36, dy + 10, 1, 1, S.OUTLINE);
    S.draw(ctx, S.PROPS.plant, dx + 26, dy + 6, propPal("#c9b8b0"));

    if (!groups.queue.length) {
      const text = "NADIE TE ESPERA";
      if (S.textWidth(text) <= z.w - 2 * ZPAD - YOUR_DESK_W) {
        S.drawText(ctx, text, z.x + ZPAD + YOUR_DESK_W + 4, dy + 16, th.muted);
      }
      return;
    }
    for (const a of groups.queue) {
      const tg = targets.get(a.id);
      const p = pos.get(a.id);
      if (!atRest(p, tg)) continue;
      drawSpotlight(tg.mx + 8, tg.my + mascotOf(a).body.h + 2, t);
      if (a.state === "waiting_input") {
        // Te hizo una pregunta: salta con un cartel "?" en alto.
        const hop = !reduced.matches && t % 10 < 2 ? -2 : 0;
        const m = mascotOf(a);
        const y = p.y + hop;
        drawMascot(a, p.x, y, { eyes: "wide", arms: ["side", "up"], legs: hop ? "none" : "stand" });
        // El brazo derecho sostiene el palo del cartel.
        const stickX = p.x + m.body.w;
        rect(stickX, y - 6, 1, m.armY + 3, S.OUTLINE);
        S.draw(ctx, S.SIGN_Q, stickX - 4, y - 14, signPal);
      } else {
        // Pide permiso: te muestra un papel para firmar.
        drawMascot(a, p.x, p.y, { eyes: "up", armDy: [1, 1] });
        S.draw(ctx, S.PAPER, p.x + 5, p.y + 5, signPal);
        drawBubble(p.x + 12, p.y - 13 + (!reduced.matches && t % 8 < 4 ? -1 : 0), "#d93619", "hand");
      }
    }
  }

  const signPal = plainPal({ W: "#fbfaf7", R: "#d93619", L: "#b9b2ad" });
  const chairPal = plainPal({ C: "#4a4352", c: "#332d3a", w: "#6a6274" });

  function drawSpotlight(cx, cy, t) {
    ctx.fillStyle = reduced.matches || t % 8 < 4 ? "rgb(217 54 25 / .32)" : "rgb(217 54 25 / .16)";
    for (let y = -3; y <= 3; y++) {
      const half = Math.round(13 * Math.sqrt(1 - (y * y) / 12.25));
      ctx.fillRect(cx - half, cy + y, half * 2, 1);
    }
  }

  // --- Salida -----------------------------------------------------------------------
  function drawExitZone(th, t) {
    const d = door();
    S.draw(ctx, S.COAT_RACK, d.x - 10, d.y + 8, plainPal({}));
    S.draw(ctx, S.DOOR, d.x, d.y, doorPal);
    rect(d.x + 5, d.y - 3, 6, 3, "#1ad988"); // luz de salida
    rect(d.x - 1, d.y + 20, 18, 4, "#7a5a45");
    for (let x = d.x; x < d.x + 16; x += 2) rect(x, d.y + 21, 1, 2, "#634634");
    for (const a of groups.exit) {
      const tg = targets.get(a.id);
      const p = pos.get(a.id);
      if (!atRest(p, tg)) continue;
      // Terminó: se despide con el maletín en la mano.
      const wave = !reduced.matches && t % 16 < 8;
      drawMascot(a, p.x, p.y, { eyes: "happy", arms: [wave ? "up" : "side", "side"] });
      S.draw(ctx, S.BRIEFCASE, p.x + 15, p.y + 7, mascotPalette(a.kind, false));
    }
  }
  const doorPal = plainPal({ F: "#8a5a3c", D: "#a8714c", d: "#93603f", Y: "#f2c84b" });

  // --- Cocina -------------------------------------------------------------------------
  function drawKitchenZone(th, t) {
    const z = layout.zones.kitchen;
    const cx = z.x + ZPAD;
    const cy = z.y + LABEL_H + 2;
    const cw = z.w - 2 * ZPAD;
    // Mesada con cafetera, fregadero y heladera.
    rect(cx, cy + 6, cw, 13, S.OUTLINE);
    rect(cx + 1, cy + 7, cw - 2, 4, th.counterTop);
    rect(cx + 1, cy + 11, cw - 2, 7, th.counterFront);
    for (let x = cx + 20; x < cx + cw - 18; x += 12) rect(x, cy + 13, 3, 1, th.deskTopHi);
    S.draw(ctx, S.COFFEE_MACHINE, cx + 4, cy - 3, coffeePal);
    if (!reduced.matches) S.draw(ctx, S.STEAM[t % 2], cx + 6, cy - 7, steamPal);
    const sink = cx + Math.floor(cw / 2) - 6;
    rect(sink, cy + 7, 12, 3, "#9aa4a8");
    rect(sink + 1, cy + 8, 10, 1, "#7d878b");
    rect(sink + 5, cy + 4, 1, 3, "#7d878b");
    rect(sink + 5, cy + 4, 3, 1, "#7d878b");
    S.draw(ctx, S.FRIDGE, cx + cw - 13, cy - 5, fridgePal);

    // Mesas con taburetes; los inactivos se sientan con su taza.
    const n = Math.max(1, Math.ceil(groups.kitchen.length / 2));
    const per = layout.unitsPerRow;
    const left = kitchenLeft();
    for (let u = 0; u < n; u++) {
      const ux = left + (u % per) * UNIT_W;
      const uy = z.y + LABEL_H + COUNTER_H + Math.floor(u / per) * layout.slotH;
      S.draw(ctx, S.STOOL, ux + 9, uy + 17, stoolPal);
      S.draw(ctx, S.STOOL, ux + 53, uy + 17, stoolPal);
      rect(ux + 37, uy + 21, 2, 6, S.OUTLINE);
      rect(ux + 33, uy + 26, 10, 2, S.OUTLINE);
      for (let y = 0; y < 7; y++) {
        const half = Math.round(10 * Math.sqrt(1 - ((y - 3) * (y - 3)) / 12.5));
        rect(ux + 37 - half, uy + 15 + y, half * 2 + 2, 1, S.OUTLINE);
        if (y > 0 && y < 6) rect(ux + 38 - half, uy + 15 + y, half * 2, 1, y < 3 ? th.deskTopHi : th.deskTop);
      }
    }
    groups.kitchen.forEach((a, i) => {
      const tg = targets.get(a.id);
      const p = pos.get(a.id);
      if (!atRest(p, tg)) return;
      const side = i % 2; // 0: a la izquierda de la mesa, 1: a la derecha
      const sip = !reduced.matches && (t + S.hash(a.name)) % 50 < 8;
      const toTable = side ? "left" : "right";
      const arms = { left: "side", right: "side" };
      if (sip) arms[toTable] = "up";
      drawMascot(a, p.x, p.y, { eyes: sip ? "closed" : "happy", legs: "none", arms: [arms.left, arms.right] });
      const mugPal = mascotPalette(a.kind, false);
      if (sip) {
        S.draw(ctx, S.MUG, side ? p.x - 4 : p.x + 15, p.y + 1, mugPal);
      } else {
        const mx = side ? p.x - 9 : p.x + 20;
        S.draw(ctx, S.MUG, mx, p.y + 8, mugPal);
        if (!reduced.matches) S.draw(ctx, S.STEAM[(t + i) % 2], mx, p.y + 4, steamPal);
      }
    });
  }
  const coffeePal = plainPal({ K: "#3b3640", R: "#ff3b1f", G: "#1ad988", S: "#fbfaf7" });
  const fridgePal = plainPal({ W: "#f1f3f4" });
  const stoolPal = plainPal({ W: "#c9553f" });
  const steamPal = plainPal({ w: "rgb(255 255 255 / .75)" });

  // --- Oficina: escritorios ---------------------------------------------------------
  function drawOffice(th, t, walking) {
    const bySeat = new Map(visible.map((a) => [seatOf.get(a.id), a]));
    for (let seat = 0; seat < layout.office.seats; seat++) {
      const { x, y } = podOrigin(seat);
      const a = bySeat.get(seat) ?? null;
      const here = Boolean(
        a && ZONE_OF[a.state] === "office" && !walking.has(a.id) && atRest(pos.get(a.id), targets.get(a.id)),
      );
      drawPod(th, x, y, a, here, t, seat);
    }
  }

  function drawPod(th, x, y, a, here, t, seat) {
    const h = S.hash(a?.name ?? `seat-${seat}`);
    rect(x + 4, y + 39, 48, 2, th.shadow);
    S.draw(ctx, S.CHAIR, x + 33, y + 13, chairPal); // respaldo asomando tras el escritorio

    const state = here ? a.state : null;
    const typing = state === "working" && !reduced.matches;
    const m = mascotOf(a);
    if (here) {
      const gray = state === "disconnected";
      if (gray) ctx.globalAlpha = 0.55;
      const shake = state === "error" && !reduced.matches ? (t % 2 ? 1 : -1) : 0;
      const nod = typing && t % 6 === 0 ? 1 : 0;
      let eyes = "left";
      if (state === "error") eyes = "x";
      else if (gray) eyes = "closed";
      else if (state === "working" && m.screen) eyes = "prompt";
      drawMascot(a, x + 32 + shake, y + 10 + nod, { eyes, legs: "none", arms: ["none", "none"], gray });
      ctx.globalAlpha = 1;
    }

    // Escritorio.
    rect(x + 3, y + 20, 50, 19, S.OUTLINE);
    rect(x + 4, y + 21, 48, 6, th.deskTop);
    rect(x + 4, y + 21, 48, 1, th.deskTopHi);
    rect(x + 4, y + 27, 48, 11, th.deskFront);
    rect(x + 4, y + 27, 48, 1, th.deskFrontDark);
    rect(x + 8, y + 31, 9, 1, th.deskFrontDark);
    rect(x + 39, y + 31, 9, 1, th.deskFrontDark);
    rect(x + 11, y + 33, 3, 1, th.deskTopHi);
    rect(x + 42, y + 33, 3, 1, th.deskTopHi);

    // Teclado delante de la mascota; sus brazos teclean sobre él.
    rect(x + 31, y + 22, 18, 4, S.OUTLINE);
    rect(x + 32, y + 23, 16, 2, "#e4dfdb");
    for (let k = 0; k < 7; k++) rect(x + 33 + k * 2, y + 23, 1, 1, "#c9c2bd");
    if (here && state !== "disconnected") {
      const pal = mascotPalette(a.kind, false);
      const l = typing ? t % 2 : 0;
      S.draw(ctx, S.ARM_DOWN, x + 31, y + 11 + m.armY - l, pal);
      S.draw(ctx, S.ARM_DOWN, x + 46, y + 11 + m.armY - (typing ? 1 - l : 0), pal, true);
      if (typing) rect(x + 33 + ((t * 5) % 7) * 2, y + 23, 1, 1, m.colors.M);
    }

    drawMonitor(th, x, y, a, state, t, h);

    // Un objeto en el escritorio, distinto por agente.
    const props = ["mug", "plant", "duck", "books"];
    const sprite = S.PROPS[props[h % props.length]];
    S.draw(ctx, sprite, x + 4, y + 26 - sprite.h, propPal(m.colors.M));
    if (h % 3 === 0) rect(x + 27, y + 6, 3, 3, "#f7d354"); // post-it en el monitor

    if (state === "error" || state === "disconnected") {
      const lift = !reduced.matches && t % 8 < 4 ? -1 : 0;
      drawBubble(x + 44, y + lift, state === "error" ? "#994739" : "#8d8584", state === "error" ? "bang" : "dots");
    }
  }

  const propPalettes = new Map();
  function propPal(main) {
    if (!propPalettes.has(main)) {
      propPalettes.set(
        main,
        plainPal({
          M: main,
          g: "#24644a",
          G: "#318561",
          T: "#994739",
          Y: "#f2c84b",
          O: "#e07a39",
          E: S.OUTLINE,
          R: "#d93619",
          B: "#2f6fd0",
        }),
      );
    }
    return propPalettes.get(main);
  }

  function drawMonitor(th, x, y, a, state, t, h) {
    const sx = x + 8;
    const sy = y + 6;
    const sw = 18;
    const sh = 11;
    if (th.glow && state && state !== "disconnected") {
      ctx.fillStyle = state === "error" ? "rgb(255 120 100 / .10)" : "rgb(150 200 255 / .08)";
      ctx.fillRect(sx, y + 21, sw, 5);
      ctx.fillRect(sx - 3, y + 21, sw + 6, 3);
    }
    rect(x + 5, y + 3, 24, 16, S.OUTLINE);
    rect(x + 6, y + 4, 22, 14, "#3b3640");
    rect(x + 6, y + 4, 22, 1, "#4d4754");
    rect(x + 15, y + 19, 4, 2, S.OUTLINE);
    rect(x + 13, y + 20, 8, 2, S.OUTLINE);

    // La pantalla muestra la terminal del agente aunque no esté sentado.
    if (!a || a.state === "exited") {
      rect(sx, sy, sw, sh, "#121116");
      rect(sx + sw - 4, sy + 1, 1, 1, "#2a2a33");
      if (a) {
        const c = "#4a4a56"; // símbolo de apagado: terminó
        rect(sx + 8, sy + 2, 2, 3, c);
        rect(sx + 6, sy + 4, 1, 4, c);
        rect(sx + 11, sy + 4, 1, 4, c);
        rect(sx + 7, sy + 8, 4, 1, c);
      }
      return;
    }
    if (a.state === "disconnected") {
      const seed = reduced.matches ? 7 : t;
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          const n = S.hash(`${px},${py},${seed},${h}`) & 255;
          rect(sx + px, sy + py, 1, 1, n > 170 ? "#c7c3c9" : n > 90 ? "#6d6873" : "#2c2930");
        }
      }
      return;
    }
    const accent = mascotOf(a).colors.M;
    if (ZONE_OF[a.state] === "kitchen") {
      // Salvapantallas: un cuadradito del color del agente que rebota.
      rect(sx, sy, sw, sh, "#101622");
      const steps = reduced.matches ? 3 : t;
      const bx = Math.abs(((steps + h) % (2 * (sw - 3))) - (sw - 3));
      const by = Math.abs(((Math.floor(steps * 0.7) + h) % (2 * (sh - 2))) - (sh - 2));
      rect(sx + bx, sy + by, 3, 2, accent);
      return;
    }
    rect(sx, sy, sw, sh, a.state === "error" ? "#3a1412" : "#17202d");
    const lines = (a.last_lines ?? []).filter((l) => l.trim() !== "").slice(-5);
    lines.forEach((text, i) => {
      const ly = sy + 1 + i * 2;
      const selected = /[❯›»]/.test(text);
      let color = a.state === "error" ? "#e0806c" : "#8ea3bd";
      if (selected) color = accent;
      if (selected && a.state === "waiting_input") {
        rect(sx, ly, sw, 1, "#d93619");
        color = "#ffffff";
      }
      miniLine(text, sw - 2).forEach((on, px) => on && rect(sx + 1 + px, ly, 1, 1, color));
    });
    if (state === "working" && t % 2 === 0) {
      const last = lines.length ? lines[lines.length - 1] : "";
      const end = Math.min(sw - 3, Math.ceil(last.trimEnd().length / 3.6) + 1);
      rect(sx + 1 + end, sy + 1 + Math.max(0, lines.length - 1) * 2, 2, 1, "#e6edf5");
    }
    if (state === "error" && !reduced.matches) {
      // Humo saliendo del monitor.
      for (let i = 0; i < 3; i++) {
        const k = (t + i * 4) % 12;
        ctx.fillStyle = `rgb(120 115 120 / ${0.6 - k * 0.045})`;
        ctx.fillRect(x + 10 + i * 6 + (k % 4 < 2 ? 0 : 1), y + 2 - Math.floor(k / 2), 2, 2);
      }
    }
  }

  function drawBubble(x, y, color, glyph) {
    const pal = plainPal({ B: color, G: "#ffffff" });
    S.draw(ctx, S.BUBBLE, x, y, pal);
    S.draw(ctx, S.GLYPHS[glyph], x + 3, y + 1, pal);
  }

  function floatShadow(x, y) {
    ctx.fillStyle = "rgb(0 0 0 / .18)";
    ctx.fillRect(x + 2, y, 12, 2);
  }

  // --- Ciclo de animación -----------------------------------------------------------
  let lastFrame = -1;
  function animate() {
    loop = requestAnimationFrame(animate);
    const f = frameNow();
    if (f !== lastFrame) {
      lastFrame = f;
      draw();
    }
  }
  function start() {
    stop();
    if (!active) return;
    lastTime = performance.now();
    if (reduced.matches) {
      draw();
      loop = setInterval(draw, 15000); // el reloj y el cielo siguen la hora
    } else {
      animate();
    }
  }
  function stop() {
    if (loop !== null) {
      cancelAnimationFrame(loop);
      clearInterval(loop);
      loop = null;
    }
  }
  reduced.addEventListener?.("change", start);
  new ResizeObserver(() => active && resize()).observe(root);
  setInterval(() => active && tickPlates(), 1000);
  new MutationObserver(() => {
    S.clearSpriteCache();
    bgKey = "";
    draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // --- API -----------------------------------------------------------------------------
  function render({ agents: all, change }) {
    agents = all;
    visible = [...agents.values()].filter((a) => !prefs.isDismissed(a));
    const { result, seats } = assignSeats(visible, prefs.seats());
    seatOf = result;
    prefs.setSeats(seats);
    groups = groupByZone(visible, seatOf);

    const ids = new Set(visible.map((a) => a.id));
    for (const [id, b] of buttons) {
      if (!ids.has(id)) {
        b.remove();
        buttons.delete(id);
        pos.delete(id);
      }
    }
    for (const a of visible) {
      if (!buttons.has(a.id)) buttons.set(a.id, createButton());
      fillButton(buttons.get(a.id), a);
    }
    if (change?.kind === "snapshot") sawSnapshot = true;
    // Un agente que llega con la página abierta entra por la puerta.
    if (change?.kind === "agent_added" && sawSnapshot && layout && active && !reduced.matches) {
      const d = door();
      pos.set(change.agent.id, { x: d.x, y: d.y + 6 });
    }
    // Orden de Tab: por lugar (te esperan, oficina, cocina, salida) y posición.
    const office = [...groups.office].sort((p, q) => seatOf.get(p.id) - seatOf.get(q.id));
    const order = [...groups.queue, ...office, ...groups.kitchen, ...groups.exit];
    const focused = document.activeElement;
    order.forEach((a) => desks.append(buttons.get(a.id)));
    if (focused && desks.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    moved = change?.kind === "agent_updated" || change?.kind === "agent_added" || change?.kind === "agent_removed";
    if (active) {
      resize();
      tickPlates();
    }
  }

  /** "Reordenar": escritorios por estado (te necesita primero) y luego por nombre. */
  function relayout() {
    const seats = {};
    sortAgents(visible).forEach((a, i) => (seats[a.name] = i));
    prefs.setSeats(seats, true);
    render({ agents, change: { kind: "local" } });
  }

  function setActive(on) {
    active = on;
    if (on) {
      layoutKey = ""; // al mostrarse, todos en su lugar
      moved = false;
      resize();
      tickPlates();
      start();
    } else {
      stop();
    }
  }

  function focusAgent(id) {
    const b = buttons.get(id);
    if (!b) return;
    b.scrollIntoView({ block: "nearest", behavior: "smooth" });
    b.focus({ preventScroll: true });
  }

  return { render, relayout, setActive, focusAgent };
}
