// Capa de RENDER (DOM + lienzo gridstack). Recibe el estado de la capa de
// datos y lo pinta. Las actualizaciones en vivo solo cambian el contenido de
// las tarjetas; la posición y el tamaño los decide el usuario.

export const LABELS = {
  working: "Trabajando",
  waiting_input: "Esperando tu respuesta",
  waiting_approval: "Esperando aprobación",
  idle: "Inactivo",
  error: "Error",
  exited: "Terminado",
  disconnected: "Desconectado",
};

export const KINDS = {
  claude: "Claude Code",
  opencode: "OpenCode",
  agy: "Antigravity",
  generic: "Comando",
};

// Solo estos cambios se anuncian a lectores de pantalla: working ↔ idle cambia
// cada pocos segundos y saturaría los anuncios.
const ANNOUNCED = new Set(["waiting_input", "waiting_approval", "error", "exited", "disconnected"]);
const ANNOUNCE_DELAY_MS = 1500;

const ORDER = ["waiting_input", "waiting_approval", "error", "working", "idle", "disconnected", "exited"];
const ENDED = new Set(["exited", "disconnected"]);

const CONN_TEXT = {
  connecting: "Conectando…",
  open: "Conectado",
  closed: "Sin conexión, reintentando…",
};

// Lienzo: 12 columnas de ancho, filas de 24 px.
export const COLUMNS = 12;
export const DEFAULT_CARD = { w: 4, h: 14 };
const MIN_CARD = { minW: 3, minH: 7 };
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

/** Posiciones en mosaico para `n` tarjetas del tamaño por defecto. */
export function tileLayout(n) {
  const perRow = Math.floor(COLUMNS / DEFAULT_CARD.w);
  return Array.from({ length: n }, (_, i) => ({
    x: (i % perRow) * DEFAULT_CARD.w,
    y: Math.floor(i / perRow) * DEFAULT_CARD.h,
    ...DEFAULT_CARD,
  }));
}

/** Aviso si el wrapper que reporta es de otra versión que el servidor. */
export function versionWarning(agentVersion, serverVersion) {
  if (!serverVersion || agentVersion === serverVersion) return null;
  if (!agentVersion) return "Este agente usa un wrapper de una versión anterior. Reinícialo para actualizarlo.";
  return `Este agente usa otra versión del wrapper (${agentVersion}). Reinícialo para actualizarlo.`;
}

export function createDomRenderer({ cards, empty, conn, live, template, prefs, GridStack, version }) {
  const els = new Map(); // id -> .grid-stack-item
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
    if (grid.getColumn() !== COLUMNS) return;
    // El fantasma de arrastre también es un nodo, pero sin tarjeta: se ignora.
    prefs.setLayouts(grid.engine.nodes.filter((n) => n.el?.dataset.name).map((n) => [n.el.dataset.name, n]));
  });
  let lastColumn = grid.getColumn();
  new ResizeObserver(() =>
    // Después del cambio de columnas de gridstack (que va con throttle).
    setTimeout(() => {
      const column = grid.getColumn();
      if (column === COLUMNS && lastColumn !== COLUMNS) restoreSaved();
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
  grid.on("resizestop", (_, el) => stickToBottom(el.querySelector(".lines")));

  function stickToBottom(pre) {
    pre.scrollTop = pre.scrollHeight;
  }

  function fill(item, a) {
    const el = item.querySelector(".card");
    item.dataset.name = a.name;
    el.dataset.state = a.state;
    el.dataset.kind = a.kind;
    el.querySelector(".kind").textContent = KINDS[a.kind] ?? a.kind;
    el.querySelector(".name").textContent = a.name;
    el.querySelector(".badge-text").textContent = LABELS[a.state] ?? a.state;
    const project = el.querySelector(".project");
    project.textContent = shortPath(a.project) || "—";
    project.title = a.project;
    el.querySelector(".branch").textContent = a.git_branch || "—";
    const pre = el.querySelector(".lines");
    const text = a.last_lines.join("\n");
    if (pre.textContent !== text) {
      // Solo se pega al final si el usuario no había subido a leer.
      const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
      pre.textContent = text;
      if (atBottom) stickToBottom(pre);
    }
    const warn = el.querySelector(".version-warn");
    const message = ENDED.has(a.state) ? null : versionWarning(a.version, serverVersion);
    warn.hidden = !message;
    warn.textContent = message ?? "";
    const dismiss = el.querySelector(".dismiss");
    dismiss.hidden = !ENDED.has(a.state);
    dismiss.setAttribute("aria-label", `Quitar ${a.name} del tablero`);
    el.setAttribute("aria-label", `${a.name} (${KINDS[a.kind] ?? a.kind}): ${LABELS[a.state] ?? a.state}`);
  }

  function createCard(a) {
    const item = template.content.firstElementChild.cloneNode(true);
    item.dataset.name = a.name;
    item.querySelector(".dismiss").addEventListener("click", () => {
      const agent = current.get(a.id);
      if (!agent) return;
      prefs.dismiss(agent);
      announce(`${agent.name} quitado del tablero`);
      rerender();
      cards.querySelector(".card")?.focus();
    });
    item.querySelector(".card").addEventListener("keydown", (ev) => onCardKey(ev, item));
    cards.append(item);
    const saved = prefs.layout(a.name);
    grid.makeWidget(item, { id: a.id, ...MIN_CARD, ...(saved ?? { ...DEFAULT_CARD, autoPosition: true }) });
    requestAnimationFrame(() => stickToBottom(item.querySelector(".lines")));
    return item;
  }

  // Mayúsculas + flechas: tamaño. Control + flechas: posición.
  function onCardKey(ev, item) {
    if (!ev.shiftKey && !ev.ctrlKey) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!delta) return;
    ev.preventDefault();
    const n = item.gridstackNode;
    const [dx, dy] = delta;
    if (ev.shiftKey) {
      grid.update(item, { w: Math.max(MIN_CARD.minW, n.w + dx), h: Math.max(MIN_CARD.minH, n.h + dy * 2) });
      announce(`Tamaño: ${item.gridstackNode.w} de ${COLUMNS} columnas`);
    } else {
      grid.update(item, { x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) });
      announce(`Posición: columna ${item.gridstackNode.x + 1}, fila ${item.gridstackNode.y + 1}`);
    }
    item.querySelector(".card").focus();
  }

  /** Ordena por estado y restablece tamaños (botón "Reordenar"). */
  function relayout() {
    const visible = sortAgents([...current.values()].filter((a) => els.has(a.id)));
    const slots = tileLayout(visible.length);
    prefs.clearLayouts();
    grid.batchUpdate();
    visible.forEach((a, i) => grid.update(els.get(a.id), slots[i]));
    grid.batchUpdate(false);
    grid.compact();
    announce("Tarjetas reordenadas por estado");
  }

  function tickTimes() {
    const now = Date.now();
    for (const [id, item] of els) {
      const a = current.get(id);
      if (!a) continue;
      item.querySelector(".since").textContent = formatDuration(now - Date.parse(a.state_since));
      item.querySelector(".session").textContent = formatDuration(now - Date.parse(a.started_at));
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
    conn.dataset.conn = connState;
    conn.querySelector(".conn-text").textContent = CONN_TEXT[connState];
    current = agents;

    if (change.kind === "snapshot") prefs.pruneDismissed(new Set(agents.keys()));
    if (
      change.kind === "agent_updated" &&
      change.prev &&
      change.prev.state !== change.agent.state &&
      ANNOUNCED.has(change.agent.state)
    ) {
      announce(`${change.agent.name}: ${LABELS[change.agent.state] ?? change.agent.state}`);
    } else if (change.kind === "agent_added") {
      announce(`Nuevo agente: ${change.agent.name}`);
    }

    // Las tarjetas nuevas se agregan en orden de estado; las existentes no se mueven.
    const visible = sortAgents([...agents.values()].filter((a) => !prefs.isDismissed(a)));
    const visibleIds = new Set(visible.map((a) => a.id));
    for (const [id, item] of els) {
      if (!visibleIds.has(id)) {
        grid.removeWidget(item);
        els.delete(id);
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
  }

  /** Enfoca la tarjeta de un agente (p. ej. al hacer clic en una notificación). */
  function focusAgent(id) {
    const card = els.get(id)?.querySelector(".card");
    if (!card) return;
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.focus({ preventScroll: true });
  }

  setInterval(tickTimes, 1000);
  return { render, relayout, focusAgent };
}
