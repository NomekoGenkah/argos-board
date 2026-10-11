// Vista OFICINA (pixel-art). Otro consumidor de la capa de datos: cada agente
// es un personaje en su escritorio y su postura cuenta el estado de lejos.
// El canvas es solo decorado (aria-hidden); lo interactivo y accesible son los
// botones HTML que se colocan encima de cada escritorio.

import * as S from "./sprites.js";
import { LABELS, KINDS, formatDuration, sortAgents } from "./render.js";

const POD_W = 60; // ancho de un escritorio, en píxeles de la escena
const POD_H = 50; // alto dibujado de un escritorio (sin la placa con el nombre)
const WALL_H = 46;
const SIDE = 10;
const PLATE_PX = 44; // alto de la placa HTML (px de pantalla)
const FRAME_MS = 160;
const NEEDS_YOU = new Set(["waiting_input", "waiting_approval"]);

const SCENE = {
  light: {
    wall: "#f1e6dd",
    wallShade: "#e6d6c9",
    panel: "#dcc6b6",
    panelLine: "#cfb6a4",
    base: "#593c37",
    plank: ["#dbb68d", "#d6b087", "#cfa67b"],
    seam: "#c39b70",
    frame: "#ffffff",
    frameShade: "#d9cfc9",
    deskTop: "#c48a5c",
    deskTopHi: "#d39d70",
    deskFront: "#9b6542",
    deskFrontDark: "#7f5034",
    shadow: "rgb(89 60 55 / .16)",
    plaque: "#593c37",
    plaqueIn: "#f8f1ec",
    iris: "#318561",
    glow: 0,
  },
  dark: {
    wall: "#2d2422",
    wallShade: "#261e1c",
    panel: "#3a2e2b",
    panelLine: "#33282a",
    base: "#1a1311",
    plank: ["#43312a", "#3f2e27", "#4c382e"],
    seam: "#33251f",
    frame: "#5a4a45",
    frameShade: "#433733",
    deskTop: "#7a5238",
    deskTopHi: "#8a5f42",
    deskFront: "#5c3c29",
    deskFrontDark: "#472d1f",
    shadow: "rgb(0 0 0 / .3)",
    plaque: "#1a1311",
    plaqueIn: "#3a2f2c",
    iris: "#1ad988",
    glow: 1,
  },
};

const EYE = {
  w: 17,
  rows: [
    ".....ooooooo.....",
    "...ooWWWWWWWoo...",
    ".ooWWWWWWWWWWWoo.",
    "oWWWWWWWWWWWWWWWo",
    "oWWWWWWWWWWWWWWWo",
    "oWWWWWWWWWWWWWWWo",
    ".ooWWWWWWWWWWWoo.",
    "...ooWWWWWWWoo...",
    ".....ooooooo.....",
  ],
};

const HEADPHONES = {
  w: 12,
  h: 7,
  rows: [
    "...oooooo...",
    "..oGGGGGGo..",
    "............",
    ".oo......oo.",
    "oGGo....oGGo",
    "oGGo....oGGo",
    ".oo......oo.",
  ],
};
// Columna donde empieza la cabeza (su contorno) en cada postura.
const HEAD_X = { back: 3, front: 3, lean: 5, panic: 5 };

/** Escala entera según el ancho disponible: píxeles grandes y nítidos. */
export function pickScale(cssWidth) {
  if (cssWidth >= 1100) return 4;
  if (cssWidth >= 560) return 3;
  return 2;
}

/**
 * Asiento estable para cada agente: el que ya tenía (por nombre) si está libre;
 * si no, el primer hueco. Devuelve id -> asiento y el mapa nombre -> asiento.
 */
export function assignSeats(agents, saved) {
  const seats = { ...saved };
  const taken = new Map(); // asiento -> id
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
export function miniLine(text, width, charsPerPx = 3.4) {
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

export function createOfficeRenderer({ root, prefs, onOpen }) {
  const stage = document.createElement("div");
  stage.className = "office-stage";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const desks = document.createElement("div");
  desks.className = "desks";
  stage.append(canvas, desks);
  root.append(stage);
  const ctx = canvas.getContext("2d");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let agents = new Map();
  let visible = []; // agentes en la oficina
  let seatOf = new Map(); // id -> asiento
  let buttons = new Map(); // id -> botón
  let layout = null;
  let active = false;
  let loop = null;
  const palettes = new Map();

  function palette(a, gray) {
    const key = `${a.kind}|${a.name}|${gray ? 1 : 0}`;
    let p = palettes.get(key);
    if (!p) {
      p = S.characterPalette(a.kind, a.name);
      if (gray) p = S.grayPalette(p);
      p.G = gray ? p.o : "#26262e"; // auriculares
      palettes.set(key, p);
    }
    return p;
  }

  // --- Geometría -------------------------------------------------------------
  function computeLayout() {
    const cssW = root.clientWidth || 1;
    const scale = pickScale(cssW);
    const vw = Math.max(POD_W + SIDE * 2, Math.floor(cssW / scale));
    const cols = Math.max(1, Math.floor((vw - SIDE * 2) / POD_W));
    const left = Math.floor((vw - cols * POD_W) / 2);
    const rowH = POD_H + Math.ceil(PLATE_PX / scale) + 8;
    const used = Math.max(0, ...[...seatOf.values()].map((s) => s + 1));
    const seats = Math.max(cols, Math.ceil(Math.max(used, 1) / cols) * cols);
    const rows = seats / cols;
    const vh = WALL_H + 10 + rows * rowH;
    return { scale, vw, vh, cols, left, rowH, seats };
  }

  function podOrigin(seat) {
    const { cols, left, rowH } = layout;
    return { x: left + (seat % cols) * POD_W, y: WALL_H + 10 + Math.floor(seat / cols) * rowH };
  }

  function resize() {
    layout = computeLayout();
    const { scale, vw, vh } = layout;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    canvas.style.width = `${vw * scale}px`;
    canvas.style.height = `${vh * scale}px`;
    stage.style.width = `${vw * scale}px`;
    stage.style.height = `${vh * scale}px`;
    placeButtons();
    draw();
  }

  // --- Botones HTML sobre cada escritorio --------------------------------------
  function placeButtons() {
    const { scale, rowH } = layout;
    for (const a of visible) {
      const b = buttons.get(a.id);
      const { x, y } = podOrigin(seatOf.get(a.id));
      b.style.left = `${x * scale}px`;
      b.style.top = `${y * scale}px`;
      b.style.width = `${POD_W * scale}px`;
      b.style.height = `${(rowH - 4) * scale}px`;
      b.style.setProperty("--plate-top", `${POD_H * scale}px`);
    }
  }

  function createButton(a) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "desk";
    b.innerHTML =
      '<span class="plate"><span class="plate-name"></span><span class="plate-state"><span class="dot" aria-hidden="true"></span><span class="plate-text"></span></span></span>';
    b.addEventListener("click", () => onOpen?.(b.dataset.id));
    desks.append(b);
    return b;
  }

  function fillButton(b, a) {
    b.dataset.id = a.id;
    b.dataset.state = a.state;
    b.dataset.kind = a.kind;
    const label = LABELS[a.state] ?? a.state;
    b.querySelector(".plate-name").textContent = a.name;
    b.setAttribute("aria-label", `${a.name} (${KINDS[a.kind] ?? a.kind}): ${label}. Abrir su tarjeta en el tablero`);
  }

  function tickPlates() {
    const now = Date.now();
    for (const a of visible) {
      const b = buttons.get(a.id);
      const since = formatDuration(now - Date.parse(a.state_since));
      const text = `${LABELS[a.state] ?? a.state} · ${since}`;
      const el = b.querySelector(".plate-text");
      if (el.textContent !== text) el.textContent = text;
      b.title = `${a.name} — ${LABELS[a.state] ?? a.state} desde hace ${since}\n${a.project}`;
    }
  }

  // --- Dibujo ------------------------------------------------------------------
  const rect = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  function frameNow() {
    return reduced.matches ? 0 : Math.floor(performance.now() / FRAME_MS);
  }

  function draw() {
    if (!layout || !active) return;
    const theme = document.documentElement.dataset.theme === "dark" ? SCENE.dark : SCENE.light;
    const t = frameNow();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFloor(theme);
    drawWall(theme, t);
    S.draw(ctx, S.BIG_PLANT, 2, WALL_H - 12, plantPalette);
    S.draw(ctx, S.BIG_PLANT, layout.vw - S.BIG_PLANT.w - 2, WALL_H - 12, plantPalette, true);

    const bySeat = new Map(visible.map((a) => [seatOf.get(a.id), a]));
    const bubbles = [];
    for (let seat = 0; seat < layout.seats; seat++) {
      const { x, y } = podOrigin(seat);
      const a = bySeat.get(seat) ?? null;
      drawPod(theme, x, y, a, t, seat);
      if (a) bubbles.push([x, y, a]);
    }
    for (const [x, y, a] of bubbles) drawBubble(x, y, a, t);
  }

  const plantPalette = { o: S.OUTLINE, g: "#24644a", G: "#318561", T: "#994739", t: "#7d3a2f" };

  function drawFloor(th) {
    // Tablas de madera largas, con las juntas desfasadas en cada hilera.
    const plankH = 5;
    for (let r = 0, y = WALL_H; y < canvas.height; r++, y += plankH) {
      rect(0, y, canvas.width, plankH, th.plank[r % 2]);
      rect(0, y + plankH - 1, canvas.width, 1, th.seam);
      const off = S.hash(`fila${r}`) % 70;
      for (let x = off; x < canvas.width; x += 70) {
        rect(x, y, 1, plankH - 1, th.seam);
        rect(x + 23, y + 2, 5, 1, th.plank[2]); // veta
      }
    }
  }

  function drawWall(th, t) {
    const { vw } = layout;
    rect(0, 0, vw, WALL_H, th.wall);
    rect(0, 0, vw, 2, th.wallShade);
    // Zócalo con paneles.
    rect(0, WALL_H - 13, vw, 10, th.panel);
    for (let x = 4; x < vw; x += 12) rect(x, WALL_H - 12, 1, 8, th.panelLine);
    rect(0, WALL_H - 13, vw, 1, th.panelLine);
    rect(0, WALL_H - 3, vw, 3, th.base);

    // Ventanas a los lados del emblema; el cielo sigue la hora real.
    const center = Math.floor(vw / 2);
    const sky = skyFor(new Date());
    const slots = [];
    for (let x = center - 66; x > 10; x -= 56) slots.push(x - 15);
    for (let x = center + 66; x < vw - 40; x += 56) slots.push(x - 15);
    for (const x of slots) drawWindow(th, x, 6, sky, t);

    drawEmblem(th, center, t);
    drawClock(th, center + 30, 15);
    drawCalendar(th, center - 37, 9);
  }

  function skyFor(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 7.5 && h < 17.5) return { bands: ["#7cc3f0", "#9fd3f4", "#c4e5f8"], clouds: true };
    if (h >= 17.5 && h < 19.5) return { bands: ["#5b5aa6", "#e0796a", "#f7b267"], clouds: false };
    if (h >= 6 && h < 7.5) return { bands: ["#7b9ad1", "#f2a7a0", "#fbd7a8"], clouds: false };
    return { bands: ["#141c3a", "#1b2650", "#26346a"], stars: true };
  }

  function drawWindow(th, x, y, sky, t) {
    const w = 30;
    const h = 22;
    rect(x - 1, y - 1, w + 2, h + 2, S.OUTLINE);
    rect(x, y, w, h, th.frame);
    const ix = x + 2;
    const iy = y + 2;
    const iw = w - 4;
    const ih = h - 4;
    const band = Math.ceil(ih / 3);
    sky.bands.forEach((c, i) => rect(ix, iy + i * band, iw, Math.min(band, ih - i * band), c));
    if (sky.clouds) {
      const drift = reduced.matches ? 0 : Math.floor(performance.now() / 900);
      for (const [cx0, cy, len] of [[3, 3, 7], [16, 9, 6]]) {
        const cx = ix + ((cx0 + drift + x) % (iw + len)) - len;
        for (let i = 0; i < len; i++) {
          const px = cx + i;
          if (px >= ix && px < ix + iw) rect(px, iy + cy, 1, 2, "#ffffff");
          if (i > 1 && i < len - 2 && px >= ix && px < ix + iw) rect(px, iy + cy - 1, 1, 1, "#ffffff");
        }
      }
    }
    if (sky.stars) {
      const stars = [[3, 2], [11, 5], [19, 3], [7, 10], [22, 12], [15, 14]];
      stars.forEach(([sx, sy], i) => {
        if ((t + i * 3 + x) % 11 !== 0) rect(ix + sx, iy + sy, 1, 1, "#fff6d8");
      });
      rect(ix + iw - 7, iy + 2, 3, 3, "#f4efd8"); // luna
      rect(ix + iw - 6, iy + 2, 2, 2, sky.bands[0]);
    }
    // Marco en cruz y alféizar.
    rect(x + Math.floor(w / 2) - 1, y, 2, h, th.frame);
    rect(x, y + Math.floor(h / 2) - 1, w, 2, th.frame);
    rect(x - 2, y + h + 1, w + 4, 2, th.frameShade);
  }

  // El emblema de Argos: un ojo que mira al agente que te necesita.
  function drawEmblem(th, cx, t) {
    const x = cx - 12;
    const y = 5;
    rect(x - 1, y - 1, 26, 19, S.OUTLINE);
    rect(x, y, 24, 17, th.plaque);
    rect(x + 2, y + 2, 20, 13, th.plaqueIn);
    const ex = cx - 8;
    const ey = y + 4;
    const blink = !reduced.matches && t % 31 === 0;
    if (blink) {
      rect(ex + 1, ey + 4, 15, 1, S.OUTLINE);
      return;
    }
    EYE.rows.forEach((row, ry) => {
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
        const row = EYE.rows[iy + py - ey];
        if (!row || row[ix + px - ex] !== "W") continue;
        const pupil = px * px + py * py <= 1;
        rect(ix + px, iy + py, 1, 1, pupil ? S.OUTLINE : th.iris);
      }
    }
    if (EYE.rows[iy - 1 - ey]?.[ix - 1 - ex] === "W") rect(ix - 1, iy - 1, 1, 1, "#ffffff");
  }

  /** A quién mira el ojo: quien te necesita; si no, recorre a los que trabajan. */
  function gaze(cx, t) {
    const pick =
      visible.find((a) => NEEDS_YOU.has(a.state)) ??
      visible.find((a) => a.state === "error") ??
      (() => {
        const busy = visible.filter((a) => a.state === "working");
        return busy.length ? busy[Math.floor(t / 20) % busy.length] : null;
      })();
    if (!pick) return [0, 1];
    const { x, y } = podOrigin(seatOf.get(pick.id));
    const tx = x + POD_W / 2;
    const dx = Math.max(-5, Math.min(5, Math.round(((tx - cx) / layout.vw) * 14)));
    const dy = y > WALL_H + 30 ? 2 : 1;
    return [dx, dy];
  }

  function drawClock(th, cx, cy) {
    const r = 6;
    for (let y = -r - 1; y <= r + 1; y++) {
      for (let x = -r - 1; x <= r + 1; x++) {
        const d = x * x + y * y;
        if (d <= (r + 0.5) ** 2) rect(cx + x, cy + y, 1, 1, "#ffffff");
        else if (d <= (r + 1.5) ** 2) rect(cx + x, cy + y, 1, 1, S.OUTLINE);
      }
    }
    for (const [x, y] of [[0, -5], [5, 0], [0, 5], [-5, 0]]) rect(cx + x, cy + y, 1, 1, th.plaque);
    const now = new Date();
    const m = now.getMinutes() / 60;
    const h = ((now.getHours() % 12) + m) / 12;
    line(cx, cy, h, 3, S.OUTLINE);
    line(cx, cy, m, 5, "#d93619");
    rect(cx, cy, 1, 1, S.OUTLINE);
  }

  function line(cx, cy, turn, len, color) {
    const a = turn * Math.PI * 2;
    for (let i = 0; i <= len; i++) {
      rect(cx + Math.round(Math.sin(a) * i), cy - Math.round(Math.cos(a) * i), 1, 1, color);
    }
  }

  function drawCalendar(th, x, y) {
    rect(x - 1, y - 1, 13, 15, S.OUTLINE);
    rect(x, y, 11, 13, "#ffffff");
    rect(x, y, 11, 4, "#d93619");
    const day = new Date().getDate();
    // Día del mes en dígitos de 3x5.
    const digits = String(day).split("").map(Number);
    let dx = x + (digits.length === 1 ? 4 : 2);
    for (const d of digits) {
      DIGITS[d].forEach((row, ry) => {
        for (let rx = 0; rx < 3; rx++) if (row[rx] === "#") rect(dx + rx, y + 6 + ry, 1, 1, S.OUTLINE);
      });
      dx += 4;
    }
    rect(x + 2, y - 2, 1, 2, th.base);
    rect(x + 8, y - 2, 1, 2, th.base);
  }

  // Geometría de un escritorio (relativa a su esquina): el personaje se sienta
  // delante, de espaldas a nosotros, mirando el monitor.
  const DESK = { x: 5, y: 19, w: 50, top: 6, front: 10 };
  const SEAT_X = 22; // columna del personaje (sprites de 16 de ancho)
  const SEAT_Y = 27; // cabeza del personaje de espaldas

  function drawPod(th, x, y, a, t, seat) {
    const state = a?.state ?? "empty";
    const look = a ? (S.KIND_LOOK[a.kind] ?? S.KIND_LOOK.generic) : null;
    const h = S.hash(a?.name ?? `seat-${seat}`);

    // Sombra en el piso y foco rojo si te necesita.
    rect(x + 5, y + DESK.y + DESK.top + DESK.front + 1, 50, 2, th.shadow);
    if (NEEDS_YOU.has(state)) drawSpotlight(x + 30, y + 44, t);

    // Escritorio.
    const dx = x + DESK.x;
    const dy = y + DESK.y;
    rect(dx, dy, DESK.w, DESK.top + DESK.front + 2, S.OUTLINE);
    rect(dx + 1, dy + 1, DESK.w - 2, DESK.top, th.deskTop);
    rect(dx + 1, dy + 1, DESK.w - 2, 1, th.deskTopHi);
    rect(dx + 1, dy + 1 + DESK.top, DESK.w - 2, DESK.front, th.deskFront);
    rect(dx + 1, dy + 1 + DESK.top, DESK.w - 2, 1, th.deskFrontDark);
    rect(dx + 4, dy + DESK.top + 4, 9, 1, th.deskFrontDark); // cajones
    rect(dx + DESK.w - 13, dy + DESK.top + 4, 9, 1, th.deskFrontDark);
    rect(dx + 7, dy + DESK.top + 6, 3, 1, th.deskTopHi);
    rect(dx + DESK.w - 10, dy + DESK.top + 6, 3, 1, th.deskTopHi);

    drawMonitor(th, x, y, a, t, h);

    // Teclado: las teclas se iluminan al teclear.
    rect(x + 21, y + 21, 18, 4, S.OUTLINE);
    rect(x + 22, y + 22, 16, 2, "#e4dfdb");
    for (let k = 0; k < 7; k++) rect(x + 23 + k * 2, y + 22, 1, 1, "#c9c2bd");
    if (state === "working" && !reduced.matches) {
      rect(x + 23 + ((t * 5) % 7) * 2, y + 22, 1, 1, look.shirt);
      rect(x + 22 + ((t * 3 + 2) % 15), y + 23, 1, 1, look.shirt);
    }
    rect(x + 41, y + 22, 3, 3, S.OUTLINE); // ratón
    rect(x + 42, y + 23, 1, 1, "#e4dfdb");

    // Un objeto en el escritorio, distinto por agente.
    const props = ["mug", "plant", "duck", "books", "lamp"];
    const prop = props[h % props.length];
    const sprite = S.PROPS[prop];
    const key = prop + (look?.shirt ?? "");
    if (!propPalettes.has(key)) {
      propPalettes.set(key, {
        o: S.OUTLINE,
        M: look?.shirt ?? "#c9b8b0",
        g: "#24644a",
        G: "#318561",
        T: "#994739",
        Y: "#f2c84b",
        O: "#e07a39",
        E: S.OUTLINE,
        R: "#d93619",
        B: "#2f6fd0",
        L: "#f2c84b",
      });
    }
    S.draw(ctx, sprite, x + 8, y + 25 - sprite.h, propPalettes.get(key));
    if (prop === "mug" && state === "working" && !reduced.matches) {
      S.draw(ctx, S.STEAM[t % 2], x + 9, y + 25 - sprite.h - 4, steamPal);
    }
    if (prop === "lamp" && th.glow) {
      ctx.fillStyle = "rgb(255 214 120 / .16)";
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 9 - i, y + 21 + i, 7 + i * 2, 1);
    }
    if (h % 3 === 0) rect(x + 47, y + 21, 3, 3, "#f7d354"); // post-it

    if (!a) {
      // Libre: silla metida bajo el escritorio.
      S.draw(ctx, S.CHAIR, x + 23, y + 33, chairPal);
      S.draw(ctx, S.CHAIR_BASE, x + 23, y + 41, chairPal);
      return;
    }
    drawAgent(x, y, a, t, look);
  }

  const propPalettes = new Map();
  const steamPal = { w: "rgb(255 255 255 / .75)" };
  const chairPal = { o: S.OUTLINE, C: "#4a4352", c: "#332d3a", w: "#6a6274" };

  function drawSpotlight(cx, cy, t) {
    const strong = reduced.matches || t % 6 < 3;
    ctx.fillStyle = strong ? "rgb(217 54 25 / .34)" : "rgb(217 54 25 / .17)";
    for (let y = -4; y <= 4; y++) {
      const half = Math.round(19 * Math.sqrt(1 - (y * y) / 20.25));
      ctx.fillRect(cx - half, cy + y, half * 2, 1);
    }
  }

  function drawMonitor(th, x, y, a, t, h) {
    const state = a?.state ?? "empty";
    const sx = x + 19;
    const sy = y + 3;
    const sw = 22;
    const sh = 11;
    // En tema oscuro la pantalla ilumina el escritorio (luz escalonada, en píxeles).
    if (th.glow && state !== "empty" && state !== "exited") {
      ctx.fillStyle = state === "error" ? "rgb(255 120 100 / .10)" : "rgb(150 200 255 / .08)";
      for (const [grow, rows] of [[0, 6], [3, 4], [6, 2]]) ctx.fillRect(sx - grow, y + 20, sw + grow * 2, rows);
    }
    rect(x + 16, y + 0, 28, 17, S.OUTLINE);
    rect(x + 17, y + 1, 26, 15, "#3b3640");
    rect(x + 17, y + 1, 26, 1, "#4d4754");
    rect(x + 28, y + 17, 4, 2, S.OUTLINE);
    rect(x + 25, y + 18, 10, 2, S.OUTLINE);
    rect(x + 26, y + 18, 8, 1, "#5a5462");

    // LED de estado en el marco.
    const led = {
      working: "#1ad988",
      waiting_input: "#ff3b1f",
      waiting_approval: "#ff3b1f",
      idle: "#f2c84b",
      error: "#ff3b1f",
    }[state];
    if (led && (!NEEDS_YOU.has(state) || reduced.matches || t % 4 < 2)) rect(x + 41, y + 15, 1, 1, led);

    if (state === "empty" || state === "exited") {
      rect(sx, sy, sw, sh, "#121116");
      rect(sx + sw - 5, sy + 1, 1, 1, "#2a2a33");
      rect(sx + sw - 4, sy + 2, 1, 1, "#2a2a33");
      if (state === "exited") {
        // Símbolo de apagado: terminó.
        const c = "#4a4a56";
        rect(sx + 10, sy + 2, 2, 3, c);
        rect(sx + 8, sy + 4, 1, 4, c);
        rect(sx + 13, sy + 4, 1, 4, c);
        rect(sx + 9, sy + 8, 4, 1, c);
        rect(sx + 9, sy + 3, 1, 1, c);
        rect(sx + 12, sy + 3, 1, 1, c);
      }
      return;
    }
    if (state === "disconnected") {
      const seed = reduced.matches ? 7 : t;
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          const n = S.hash(`${px},${py},${seed},${h}`) & 255;
          rect(sx + px, sy + py, 1, 1, n > 170 ? "#c7c3c9" : n > 90 ? "#6d6873" : "#2c2930");
        }
      }
      return;
    }
    const bg = state === "error" ? "#3a1412" : "#17202d";
    rect(sx, sy, sw, sh, bg);
    const lines = (a.last_lines ?? []).filter((l) => l.trim() !== "").slice(-5);
    const accent = (S.KIND_LOOK[a.kind] ?? S.KIND_LOOK.generic).shirt;
    lines.forEach((text, i) => {
      const ly = sy + 1 + i * 2;
      const selected = /[❯›»]/.test(text);
      let color = state === "error" ? "#e0806c" : "#8ea3bd";
      if (selected) color = accent;
      if (selected && state === "waiting_input") {
        rect(sx, ly, sw, 1, "#d93619");
        color = "#ffffff";
      }
      miniLine(text, sw - 2).forEach((on, px) => on && rect(sx + 1 + px, ly, 1, 1, color));
    });
    if (state === "working" && t % 2 === 0) {
      const last = lines.length ? lines[lines.length - 1] : "";
      const end = Math.min(sw - 3, Math.ceil(last.trimEnd().length / 3.4) + 1);
      rect(sx + 1 + end, sy + 1 + Math.max(0, lines.length - 1) * 2, 2, 1, "#e6edf5");
    }
    rect(sx + sw - 3, sy, 3, 1, "rgb(255 255 255 / .08)");
  }

  function drawAgent(x, y, a, t, look) {
    const gray = a.state === "disconnected";
    const pal = palette(a, gray);
    const still = reduced.matches;
    const bob = look.floats && !still && !gray && t % 8 >= 4 ? -1 : 0; // agy flota (antigravedad)
    const cx = x + SEAT_X;
    const cy = y + SEAT_Y + bob;

    if (a.state === "exited") {
      // Se fue: silla vacía y corrida, con la chaqueta colgada.
      S.draw(ctx, S.CHAIR, x + 31, y + 37, chairPal);
      S.draw(ctx, S.CHAIR_BASE, x + 31, y + 45, chairPal);
      S.draw(ctx, S.JACKET, x + 32, y + 35, pal);
      return;
    }

    if (gray) ctx.globalAlpha = 0.6;
    const base = (bx, by) => {
      if (look.floats && !gray) {
        // Antigravedad: sin ruedas, flota sobre su sombra.
        ctx.fillStyle = "rgb(0 0 0 / .18)";
        ctx.fillRect(bx + 1, by + 3, 12, 2);
        if (!still) {
          const sp = t % 3;
          rect(bx + 2 + sp * 4, by + 1 + (t % 2), 1, 1, "#9cc1ff");
          rect(bx + 11 - sp * 3, by + 2, 1, 1, "#d7e6ff");
        }
      } else {
        S.draw(ctx, S.CHAIR_BASE, bx, by + bob, chairPal);
      }
    };

    switch (a.state) {
      case "waiting_input":
      case "waiting_approval": {
        // Giró la silla: te mira.
        const fy = cy - 4;
        S.draw(ctx, S.CHAIR, x + 23, fy + 5, chairPal);
        S.draw(ctx, S.FRONT, cx, fy, pal);
        if (look.headphones) S.draw(ctx, HEADPHONES, cx + HEAD_X.front - 1, fy + 1, pal);
        if (a.state === "waiting_input") {
          S.draw(ctx, S.HIDE_HAND, cx + 13, fy + 13, pal);
          S.draw(ctx, still || t % 4 < 2 ? S.WAVE_A : S.WAVE_B, cx + 14, fy - 2, pal);
        } else {
          S.draw(ctx, S.PAPER, cx + 2, fy + 9, pal);
        }
        base(x + 23, fy + 18);
        break;
      }
      case "idle": {
        S.draw(ctx, S.LEAN, cx - 2, cy + 1, pal);
        if (look.headphones) S.draw(ctx, HEADPHONES, cx - 2 + HEAD_X.lean - 1, cy + 1, pal);
        S.draw(ctx, S.CHAIR_LOW, x + 23, cy + 12, chairPal);
        base(x + 23, cy + 16);
        break;
      }
      case "error": {
        const shake = still ? 0 : t % 2 === 0 ? -1 : 1;
        S.draw(ctx, S.PANIC, cx - 2 + shake, cy, pal);
        S.draw(ctx, S.CHAIR_LOW, x + 23, cy + 12, chairPal);
        base(x + 23, cy + 16);
        break;
      }
      default: {
        // working (y disconnected, quieto y gris).
        const typing = a.state === "working" && !still;
        const nod = typing && t % 4 === 1 ? 1 : 0;
        S.draw(ctx, S.BACK, cx, cy + nod, pal);
        if (look.headphones) S.draw(ctx, HEADPHONES, cx + HEAD_X.back - 1, cy + nod, pal);
        const left = typing ? t % 2 : 0;
        S.draw(ctx, S.ELBOW, cx - 2, cy + 9 - left, pal);
        S.draw(ctx, S.ELBOW, cx + 15, cy + 9 - (typing ? 1 - left : 0), pal, true);
        S.draw(ctx, S.CHAIR_LOW, x + 23, cy + 12, chairPal);
        base(x + 23, cy + 16);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBubble(x, y, a, t) {
    const still = reduced.matches;
    const kinds = {
      waiting_input: ["#d93619", "question"],
      waiting_approval: ["#d93619", "hand"],
      error: ["#994739", "bang"],
      disconnected: ["#8d8584", "dots"],
    };
    if (a.state === "idle") {
      if (still) return;
      const phase = t % 12;
      ctx.globalAlpha = phase < 9 ? 0.9 : 0.4;
      S.draw(ctx, S.ZZZ, x + 41 + (phase % 4 < 2 ? 0 : 1), y + 25 - Math.floor(phase / 2), zPal);
      ctx.globalAlpha = 1;
      return;
    }
    const k = kinds[a.state];
    if (!k) return;
    const lift = NEEDS_YOU.has(a.state) && !still && t % 6 < 3 ? -1 : 0;
    const bx = x + 42;
    const by = y + 9 + lift;
    const pal = bubblePal(k[0]);
    S.draw(ctx, S.BUBBLE, bx, by, pal);
    S.draw(ctx, S.GLYPHS[k[1]], bx + 3, by + 1, pal);
  }

  const zPal = { G: "#74625e" };
  const bubblePals = new Map();
  function bubblePal(color) {
    if (!bubblePals.has(color)) bubblePals.set(color, { o: S.OUTLINE, B: color, G: "#ffffff" });
    return bubblePals.get(color);
  }

  // --- Ciclo de animación -----------------------------------------------------
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
    draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // --- API ---------------------------------------------------------------------
  function render({ agents: all }) {
    agents = all;
    visible = [...agents.values()].filter((a) => !prefs.isDismissed(a));
    const { result, seats } = assignSeats(visible, prefs.seats());
    seatOf = result;
    prefs.setSeats(seats);
    const ids = new Set(visible.map((a) => a.id));
    for (const [id, b] of buttons) {
      if (!ids.has(id)) {
        b.remove();
        buttons.delete(id);
      }
    }
    for (const a of visible) {
      if (!buttons.has(a.id)) buttons.set(a.id, createButton(a));
      fillButton(buttons.get(a.id), a);
    }
    // Orden de Tab = orden visual (fila y columna del asiento).
    const order = [...visible].sort((p, q) => seatOf.get(p.id) - seatOf.get(q.id));
    const focused = document.activeElement;
    order.forEach((a) => desks.append(buttons.get(a.id)));
    if (focused && desks.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    if (active) {
      resize();
      tickPlates();
    }
  }

  /** "Reordenar": asientos por estado (te necesita primero) y luego por nombre. */
  function relayout() {
    const seats = {};
    sortAgents(visible).forEach((a, i) => (seats[a.name] = i));
    prefs.setSeats(seats, true);
    render({ agents });
  }

  function setActive(on) {
    active = on;
    if (on) {
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


const DIGITS = [
  ["###", "#.#", "#.#", "#.#", "###"],
  [".#.", "##.", ".#.", ".#.", "###"],
  ["###", "..#", "###", "#..", "###"],
  ["###", "..#", ".##", "..#", "###"],
  ["#.#", "#.#", "###", "..#", "..#"],
  ["###", "#..", "###", "..#", "###"],
  ["###", "#..", "###", "#.#", "###"],
  ["###", "..#", ".#.", ".#.", ".#."],
  ["###", "#.#", "###", "#.#", "###"],
  ["###", "#.#", "###", "..#", "###"],
];
