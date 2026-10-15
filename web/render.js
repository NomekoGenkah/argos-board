// Capa de RENDER (DOM + lienzo gridstack). Recibe el estado de la capa de
// datos y lo pinta. Las actualizaciones en vivo solo cambian el contenido de
// las tarjetas; la posición y el tamaño los decide el usuario.

import { applyDom, t } from "./i18n.js";

import { createTermView } from "./term.js";
import { DEFAULT_TERM_THEME } from "./termthemes.js";
import { cardSizeFor, DEFAULT_TERM_MODE, gridOf } from "./termgrid.js";
import { createConsole } from "./console.js";
import { launchText, wireStopButton } from "./launcher.js";

export const LABELS = {
  working: t("state.working"),
  waiting_input: t("state.waiting_input"),
  waiting_approval: t("state.waiting_approval"),
  idle: t("state.idle"),
  error: t("state.error"),
  exited: t("state.exited"),
  disconnected: t("state.disconnected"),
};

export { KINDS } from "./kinds.js";
import { KINDS } from "./kinds.js";

// Solo estos cambios se anuncian a lectores de pantalla: working ↔ idle cambia
// cada pocos segundos y saturaría los anuncios.
const ANNOUNCED = new Set(["waiting_input", "waiting_approval", "error", "exited", "disconnected"]);
const ANNOUNCE_DELAY_MS = 1500;

const ORDER = ["waiting_input", "waiting_approval", "error", "working", "idle", "disconnected", "exited"];
const ENDED = new Set(["exited", "disconnected"]);

const CONN_TEXT = {
  connecting: t("conn.connecting"),
  open: t("conn.open"),
  closed: t("conn.closed"),
};

// Lienzo: 12 columnas de ancho, filas de 24 px.
export const COLUMNS = 12;
export const DEFAULT_CARD = { w: 4, h: 17 };
const MIN_CARD = { minW: 3, minH: 7 };
const MAX_FIT_H = 28;
const RAIL_W = 4; // columnas de la lista lateral de la disposición «foco»
const RAIL_H = 9; // filas de cada tarjeta de esa lista // tope al agrandar una tarjeta nueva para que entre su contenido
const STACK_BELOW_PX = 700; // por debajo, una sola columna (móvil)

export function shortPath(p) {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join("/")}`;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function sortAgents(list) {
  return [...list].sort((a, b) => {
    const d = ORDER.indexOf(a.state) - ORDER.indexOf(b.state);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

/** Posiciones en mosaico para `n` tarjetas de un mismo tamaño (por defecto, el básico). */
export function tileLayout(n, size = DEFAULT_CARD) {
  const perRow = Math.max(1, Math.floor(COLUMNS / size.w));
  return Array.from({ length: n }, (_, i) => ({
    x: (i % perRow) * size.w,
    y: Math.floor(i / perRow) * size.h,
    w: size.w,
    h: size.h,
  }));
}

/** Línea "lanzado desde la página" (y cómo tomarlo en tmux) y el botón Detener. */
export function fillLaunch(el, a, auth) {
  const info = launchText(a);
  const line = el.querySelector(".launch-line");
  line.hidden = !info;
  if (info) {
    line.querySelector(".launch-text").textContent = info.text;
    const code = line.querySelector(".launch-code");
    code.hidden = !info.code;
    code.textContent = info.code ?? "";
  }
  const stopBtn = el.querySelector(".stop");
  stopBtn.hidden = !(a.launch && auth === "ok" && a.state !== "exited");
}

/** Aviso si el wrapper que reporta es de otra versión que el servidor. */
export function versionWarning(agentVersion, serverVersion) {
  if (!serverVersion || agentVersion === serverVersion) return null;
  if (!agentVersion) return t("warn.old");
  return t("warn.other", agentVersion);
}

export function createDomRenderer({ cards, empty, conn, live, template, prefs, GridStack, version, sendInput, voice, uploadFile, stop, onOpenAgent }) {
  const els = new Map(); // id -> .grid-stack-item
  const consoles = new Map(); // id -> consola de la tarjeta
  const views = new Map(); // id -> vista de la terminal de la tarjeta
  let layoutMode = "canvas"; // canvas | grid | focus
  let focusName = prefs.focusName(); // agente en primer plano de la disposición «foco»
  let arrangedKey = "";
  let arrangeQueued = false;
  let auth = "none";
  let current = new Map();
  let lastEvent = null;
  let serverVersion = null;

  const grid = GridStack.init(
    {
      column: COLUMNS,
      cellHeight: 24,
      margin: 8,
      float: false, // las tarjetas suben y se empujan, nunca se superponen
      animate: true,
      handle: ".card-head",
      resizable: { handles: "e, se, s" },
      columnOpts: { breakpoints: [{ w: STACK_BELOW_PX, c: 1 }], layout: "list" },
    },
    cards,
  );

  // Se guarda solo el lienzo de escritorio; el apilado de móvil es derivado.
  // Al volver a escritorio, gridstack recoloca a su manera: se restaura lo guardado.
  // (gridstack no emite "change" al cambiar de columnas: se vigila el ancho.)
  /**
   * El orden del teclado (Tab) y de los lectores de pantalla sigue al DOM, no a
   * la posición visual: se reordena el DOM por fila y columna del lienzo.
   */
  function syncDomOrder() {
    const items = [...cards.querySelectorAll(":scope > .grid-stack-item")].filter((i) => i.gridstackNode);
    const sorted = [...items].sort((a, b) => a.gridstackNode.y - b.gridstackNode.y || a.gridstackNode.x - b.gridstackNode.x);
    if (sorted.every((item, i) => item === items[i])) return;
    const focused = document.activeElement;
    for (const item of sorted) cards.append(item);
    if (focused && cards.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  grid.on("change", () => {
    syncDomOrder();
    if (grid.getColumn() !== COLUMNS || layoutMode !== "canvas") return; // solo el lienzo libre se recuerda
    // El fantasma de arrastre también es un nodo, pero sin tarjeta: se ignora.
    prefs.setLayouts(grid.engine.nodes.filter((n) => n.el?.dataset.name).map((n) => [n.el.dataset.name, n]));
  });
  let lastColumn = grid.getColumn();
  new ResizeObserver(() =>
    // Después del cambio de columnas de gridstack (que va con throttle).
    setTimeout(() => {
      const column = grid.getColumn();
      if (column === COLUMNS && lastColumn !== COLUMNS) {
        if (layoutMode === "canvas") restoreSaved();
        else arrange();
      }
      if (column !== lastColumn) decorate();
      // Apiladas en una columna, filas más altas: la pantalla del agente y la consola entran.
      const cell = column === 1 ? 30 : 24;
      if (grid.getCellHeight() !== cell) grid.cellHeight(cell);
      // En una columna el alto no se guarda: cada tarjeta toma el que necesita.
      if (column === 1) requestAnimationFrame(() => els.forEach(fitHeight));
      lastColumn = column;
    }, 200),
  ).observe(cards);

  function restoreSaved() {
    grid.batchUpdate();
    for (const item of els.values()) {
      const l = prefs.layout(item.dataset.name);
      if (l) grid.update(item, l);
    }
    grid.batchUpdate(false);
  }
  function fill(item, a) {
    const el = item.querySelector(".card");
    item.dataset.name = a.name;
    el.dataset.state = a.state;
    el.dataset.kind = a.kind;
    const kind = el.querySelector(".kind");
    kind.textContent = KINDS[a.kind] ?? a.kind;
    kind.hidden = a.name.toLowerCase().includes(a.kind); // «claude» ya dice Claude Code
    el.querySelector(".name").textContent = a.name;
    el.querySelector(".badge-text").textContent = LABELS[a.state] ?? a.state;
    const project = el.querySelector(".project");
    project.textContent = shortPath(a.project) || "—";
    project.title = a.project;
    el.querySelector(".branch").textContent = a.git_branch || "—";
    el.querySelector(".term").setAttribute("aria-label", t("card.terminalOf", a.name));
    views.get(a.id)?.update(a);
    const warn = el.querySelector(".version-warn");
    const message = ENDED.has(a.state) ? null : versionWarning(a.version, serverVersion);
    warn.hidden = !message;
    warn.textContent = message ?? "";
    fillLaunch(el, a, auth);
    const dismiss = el.querySelector(".dismiss");
    dismiss.hidden = !ENDED.has(a.state);
    dismiss.setAttribute("aria-label", t("card.dismissAria", a.name));
    el.setAttribute("aria-label", t("card.aria", a.name, KINDS[a.kind] ?? a.kind, LABELS[a.state] ?? a.state));
    consoles.get(a.id)?.update(a, auth);
  }

  function createCard(a) {
    const item = template.content.firstElementChild.cloneNode(true);
    applyDom(item);
    item.dataset.name = a.name;
    item.querySelector(".dismiss").addEventListener("click", () => {
      const agent = current.get(a.id);
      if (!agent) return;
      prefs.dismiss(agent);
      announce(t("ann.dismissed", agent.name));
      rerender();
      cards.querySelector(".card")?.focus();
    });
    item.querySelector(".card").addEventListener("keydown", (ev) => onCardKey(ev, item));
    item.querySelector(".card").addEventListener("click", (ev) => {
      if (isRail(item) && !ev.target.closest("button, a")) setFocus(item.dataset.name);
    });
    wireStopButton(item.querySelector(".stop"), {
      getAgent: () => current.get(a.id),
      stop,
      onDone: (error) => announce(error ? t("ann.stopFailed", a.name, error) : t("ann.stopped", a.name)),
    });
    item.querySelector(".stop").setAttribute("aria-label", t("card.stopAria", a.name));
    item.querySelector(".expand")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpenAgent?.(a.id);
    });
    item.querySelector(".card-head")?.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("a")) return;
      if (window.innerWidth <= 700) {
        onOpenAgent?.(a.id);
      }
    });
    item.querySelector(".term")?.addEventListener("dblclick", () => {
      onOpenAgent?.(a.id);
    });
    views.set(a.id, createTermView(item.querySelector(".term"), { theme: prefs.termTheme() ?? DEFAULT_TERM_THEME, mode: prefs.termMode() ?? DEFAULT_TERM_MODE }));
    const con = createConsole({ sendInput, voice, uploadFile });
    item.querySelector(".console-slot").append(con.el);
    consoles.set(a.id, con);
    cards.append(item);
    const saved = prefs.layout(a.name);
    grid.makeWidget(item, { id: a.id, ...MIN_CARD, ...(saved ?? { ...sizeFor([a]), autoPosition: true }) });
    // Una tarjeta nueva (sin tamaño guardado) toma, una sola vez, el alto que
    // necesita su contenido (p. ej. un agente lanzado: botones, tmux y consola),
    // cuando gridstack ya la acomodó (es idempotente).
    if (!saved) for (const ms of [50, 450]) setTimeout(() => layoutMode === "canvas" && fitHeight(item), ms);
    return item;
  }

  /** Agranda la tarjeta (nunca la achica) hasta que entre su contenido. Idempotente. */
  function fitHeight(item) {
    const card = item.querySelector(".card");
    const node = item.gridstackNode;
    if (!node || !item.isConnected) return;
    if (stacked()) {
      // Apiladas en una columna cada tarjeta mide lo que su contenido: ni cortada ni con un hueco al final.
      const need = [...card.children].reduce((n, c) => n + c.offsetHeight, 0) + 2;
      const h = Math.ceil((need + item.offsetHeight - card.clientHeight) / grid.getCellHeight());
      if (h !== node.h) grid.update(item, { h });
      return;
    }
    if (card.scrollHeight <= card.clientHeight + 1) return;
    // Lo que ocupa el contenido + el margen de la celda, en filas.
    const chrome = item.offsetHeight - card.clientHeight;
    const h = Math.min(MAX_FIT_H, Math.ceil((card.scrollHeight + chrome) / grid.getCellHeight()));
    if (h > node.h) grid.update(item, { h });
  }

  // Mayúsculas + flechas: tamaño. Control + flechas: posición.
  function onCardKey(ev, item) {
    if (ev.target !== ev.currentTarget) return; // no robar teclas a la consola ni a los botones
    if (ev.key === "Enter" && isRail(item)) {
      ev.preventDefault();
      setFocus(item.dataset.name);
      return;
    }
    if (layoutMode !== "canvas") return; // en cuadrícula y foco las tarjetas no se mueven
    if (!ev.shiftKey && !ev.ctrlKey) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!delta) return;
    ev.preventDefault();
    const n = item.gridstackNode;
    const [dx, dy] = delta;
    if (ev.shiftKey) {
      grid.update(item, { w: Math.max(MIN_CARD.minW, n.w + dx), h: Math.max(MIN_CARD.minH, n.h + dy * 2) });
      announce(t("ann.size", item.gridstackNode.w, COLUMNS));
    } else {
      grid.update(item, { x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) });
      announce(t("ann.pos", item.gridstackNode.x + 1, item.gridstackNode.y + 1));
    }
    item.querySelector(".card").focus();
  }

  /** Ordena por estado y restablece tamaños (botón "Reordenar"). */
  function relayout() {
    if (layoutMode !== "canvas") return;
    const visible = sortAgents([...current.values()].filter((a) => els.has(a.id)));
    const slots = tileLayout(visible.length, sizeFor(visible));
    prefs.clearLayouts();
    grid.batchUpdate();
    visible.forEach((a, i) => grid.update(els.get(a.id), slots[i]));
    grid.batchUpdate(false);
    grid.compact();
    announce(t("ann.relayout"));
  }

  // ---- Disposiciones: lienzo (libre), cuadrícula (iguales) y foco (uno grande y una lista).
  const stacked = () => grid.getColumn() !== COLUMNS;
  /** ¿Es una tarjeta de la lista lateral del «foco» (y no el agente en primer plano)? */
  const isRail = (item) => layoutMode === "focus" && !stacked() && item.dataset.name !== focusName;

  function visibleAgents() {
    return [...current.values()].filter((a) => els.has(a.id));
  }

  /** Agente en primer plano: el elegido o, si ya no está, el que más urge. */
  function pickFocus(list) {
    if (list.some((a) => a.name === focusName)) return focusName;
    return (sortAgents(list)[0] ?? list[0])?.name ?? null;
  }

  function decorate() {
    for (const item of els.values()) item.querySelector(".card").classList.toggle("card--compact", isRail(item));
  }

  /** Coloca las tarjetas según la disposición (en una columna no hace falta: se apilan). */
  function arrange() {
    arrangeQueued = false;
    if (layoutMode === "canvas" || stacked()) {
      arrangedKey = layoutKey();
      return decorate();
    }
    const list = visibleAgents().sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    if (!list.length) return;
    grid.batchUpdate();
    if (layoutMode === "grid") {
      const slots = tileLayout(list.length, sizeFor(list));
      list.forEach((a, i) => grid.update(els.get(a.id), slots[i]));
    } else {
      focusName = pickFocus(list);
      const main = list.find((a) => a.name === focusName);
      const rail = sortAgents(list.filter((a) => a !== main));
      const mainW = rail.length ? COLUMNS - RAIL_W : COLUMNS;
      const size = sizeFor([main], { widths: [mainW], maxH: 34 });
      grid.update(els.get(main.id), { x: 0, y: 0, w: mainW, h: Math.max(size.h, rail.length * RAIL_H) });
      rail.forEach((a, i) => grid.update(els.get(a.id), { x: mainW, y: i * RAIL_H, w: RAIL_W, h: RAIL_H }));
    }
    grid.batchUpdate(false);
    arrangedKey = layoutKey();
    decorate();
  }

  /** Qué tiene que estar acomodado: la disposición, quién está al frente y qué tarjetas hay. */
  function layoutKey() {
    const list = visibleAgents();
    const front = layoutMode === "focus" ? pickFocus(list) : "";
    return `${layoutMode}|${front}|${list.map((a) => a.id).sort().join()}`;
  }

  /** Reacomoda solo si cambió algo de eso (no con cada actualización en vivo). */
  function queueArrange() {
    if (arrangeQueued || layoutKey() === arrangedKey) return;
    arrangeQueued = true;
    requestAnimationFrame(arrange);
  }

  /** Cambia el agente en primer plano (disposición «foco»). */
  function setFocus(name) {
    if (!name || name === focusName) return;
    focusName = name;
    prefs.setFocusName(name);
    announce(t("ann.front", name));
    arrange();
    els.get([...current.values()].find((a) => a.name === name)?.id)?.querySelector(".card")?.focus({ preventScroll: true });
  }

  /** Cambia la disposición del tablero. */
  function setLayout(mode) {
    layoutMode = mode;
    cards.dataset.layout = mode;
    grid.setStatic(mode !== "canvas");
    if (mode === "canvas") {
      restoreSaved();
      decorate();
    } else {
      arrange();
    }
  }

  function tickTimes() {
    const now = Date.now();
    for (const [id, item] of els) {
      const a = current.get(id);
      if (!a) continue;
      item.querySelector(".since").textContent = formatDuration(now - Date.parse(a.state_since));
      item.querySelector(".name").title = t("card.session", formatDuration(now - Date.parse(a.started_at)));
    }
  }

  // Los anuncios se agrupan: varios cambios seguidos se leen en un solo mensaje.
  let pending = [];
  let flushTimer = null;
  function announce(text) {
    pending.push(text);
    flushTimer ??= setTimeout(() => {
      const p = document.createElement("p");
      p.textContent = pending.join(". ");
      live.append(p);
      while (live.childElementCount > 3) live.firstElementChild.remove();
      pending = [];
      flushTimer = null;
    }, ANNOUNCE_DELAY_MS);
  }

  function rerender() {
    if (lastEvent) render({ ...lastEvent, change: { kind: "local" } });
  }

  function render(event) {
    const { agents, conn: connState, change } = event;
    if (event.serverVersion && event.serverVersion !== serverVersion) {
      serverVersion = event.serverVersion;
      version.textContent = `v${serverVersion}`;
    }
    lastEvent = event;
    auth = event.auth ?? "none";
    conn.dataset.conn = connState;
    conn.querySelector(".conn-text").textContent = CONN_TEXT[connState];
    current = agents;

    if (change.kind === "snapshot") {
      prefs.pruneDismissed(new Set(agents.keys()));
      // Con el tablero vacío (servidor recién arrancado) no se poda por nombre:
      // se perderían posiciones y escritorios de agentes que aún no reconectan.
      if (agents.size > 0) {
        const liveNames = new Set([...agents.values()].map((a) => a.name));
        prefs.pruneLayouts(liveNames);
        prefs.pruneSeats(liveNames);
      }
    }
    if (
      change.kind === "agent_updated" &&
      change.prev &&
      change.prev.state !== change.agent.state &&
      ANNOUNCED.has(change.agent.state)
    ) {
      announce(t("ann.stateChange", change.agent.name, LABELS[change.agent.state] ?? change.agent.state));
    } else if (change.kind === "agent_added") {
      announce(t("ann.newAgent", change.agent.name));
    }

    // Las tarjetas nuevas se agregan en orden de estado; las existentes no se mueven.
    const visible = sortAgents([...agents.values()].filter((a) => !prefs.isDismissed(a)));
    const visibleIds = new Set(visible.map((a) => a.id));
    for (const [id, item] of els) {
      if (!visibleIds.has(id)) {
        grid.removeWidget(item);
        els.delete(id);
        consoles.delete(id);
        views.get(id)?.dispose();
        views.delete(id);
      }
    }
    for (const a of visible) {
      let item = els.get(a.id);
      if (!item) {
        item = createCard(a);
        els.set(a.id, item);
        syncDomOrder();
      }
      fill(item, a);
    }
    empty.hidden = visible.length > 0 || connState !== "open";
    tickTimes();
    if (layoutMode !== "canvas") queueArrange();
  }

  /** Enfoca la tarjeta de un agente (p. ej. al hacer clic en una notificación). */
  function focusAgent(id) {
    const name = current.get(id)?.name;
    if (layoutMode === "focus" && name) setFocus(name);
    const card = els.get(id)?.querySelector(".card");
    if (!card) return;
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.focus({ preventScroll: true });
  }

  /**
   * Tamaño de una tarjeta nueva: el que deja la letra de su terminal legible (unos 9 px) con el ancho
   * disponible. En una columna (móvil) vale el básico: ahí cada tarjeta toma el alto que necesita.
   */
  function sizeFor(agents, options = {}) {
    if (grid.getColumn() !== COLUMNS || cards.clientWidth < STACK_BELOW_PX) return DEFAULT_CARD;
    const grids = agents.map(gridOf);
    return cardSizeFor({
      containerPx: cards.clientWidth,
      columns: COLUMNS,
      cellPx: grid.getCellHeight(),
      cols: Math.max(80, ...grids.map((g) => g.cols)),
      rows: Math.max(24, ...grids.map((g) => g.rows)),
      ...options,
    });
  }

  /** Cambia el modo de ajuste de la terminal de todas las tarjetas. */
  function setTermMode(mode) {
    for (const view of views.values()) view.setMode(mode);
  }

  /** Cambia el tema de la terminal de todas las tarjetas. */
  function setTermTheme(name) {
    for (const view of views.values()) view.setTheme(name);
  }

  setInterval(tickTimes, 1000);
  return { render, relayout, focusAgent, setTermTheme, setTermMode, setLayout };
}
