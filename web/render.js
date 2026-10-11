// Capa de RENDER (DOM). Recibe el estado de la capa de datos y lo pinta.
// Las preferencias locales (tamaños, tarjetas quitadas) llegan por `prefs`.

const LABELS = {
  working: "Trabajando",
  waiting_approval: "Esperando aprobación",
  idle: "Inactivo",
  error: "Error",
  exited: "Terminado",
  disconnected: "Desconectado",
};

const KINDS = {
  claude: "Claude Code",
  opencode: "OpenCode",
  agy: "Antigravity",
  generic: "Comando",
};

const ORDER = ["waiting_approval", "error", "working", "idle", "disconnected", "exited"];
const ENDED = new Set(["exited", "disconnected"]);

const CONN_TEXT = {
  connecting: "Conectando…",
  open: "Conectado",
  closed: "Sin conexión, reintentando…",
};

export const MIN_LINES = 3;
export const MAX_LINES = 80;

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

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Columnas que caben y su ancho. Se calcula desde el ancho disponible (igual
 * que `auto-fill` en el CSS) y no leyendo la grilla, porque una tarjeta que
 * ocupa N columnas fuerza a que existan N aunque no quepan.
 */
export function columnsFor(width, colMin, gap) {
  const min = Math.min(width, colMin);
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  return { cols, colWidth: (width - gap * (cols - 1)) / cols, gap };
}

function gridMetrics(container) {
  const cs = getComputedStyle(container);
  return columnsFor(container.clientWidth, parseFloat(cs.getPropertyValue("--col-min")) || 400, parseFloat(cs.columnGap) || 0);
}

export function createDomRenderer({ cards, empty, conn, live, template, prefs }) {
  const els = new Map(); // id -> article
  let current = new Map();
  let lastEvent = null;

  function applySize(el, name) {
    const { span, lines } = prefs.size(name);
    const { cols } = gridMetrics(cards);
    el.style.gridColumn = `span ${clamp(span, 1, cols)}`;
    el.style.setProperty("--lines", clamp(lines, MIN_LINES, MAX_LINES));
  }

  function stickToBottom(pre) {
    pre.scrollTop = pre.scrollHeight;
  }

  function fill(el, a) {
    el.dataset.state = a.state;
    el.dataset.kind = a.kind;
    el.dataset.name = a.name;
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
    const dismiss = el.querySelector(".dismiss");
    dismiss.hidden = !ENDED.has(a.state);
    dismiss.setAttribute("aria-label", `Quitar ${a.name} del tablero`);
    el.setAttribute("aria-label", `${a.name} (${KINDS[a.kind] ?? a.kind}): ${LABELS[a.state] ?? a.state}`);
  }

  function createCard(a) {
    const el = template.content.firstElementChild.cloneNode(true);
    el.querySelector(".dismiss").addEventListener("click", () => {
      const agent = current.get(a.id);
      if (!agent) return;
      // El foco pasa a la tarjeta siguiente (o a la anterior) para no perderlo.
      const next = el.nextElementSibling ?? el.previousElementSibling;
      prefs.dismiss(agent);
      announce(`${agent.name} quitado del tablero`);
      rerender();
      (next ?? cards).focus?.();
    });
    setupResize(el);
    applySize(el, a.name);
    requestAnimationFrame(() => stickToBottom(el.querySelector(".lines")));
    return el;
  }

  function setupResize(el) {
    const handle = el.querySelector(".resize");
    const pre = el.querySelector(".lines");

    const commit = (span, lines) => {
      prefs.setSize(el.dataset.name, { span, lines });
      applySize(el, el.dataset.name);
      stickToBottom(pre);
    };

    handle.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      el.classList.add("resizing");
      const start = { x: ev.clientX, y: ev.clientY, w: el.offsetWidth, h: pre.clientHeight };
      const lineH = parseFloat(getComputedStyle(pre).lineHeight) || 18;
      const startLines = prefs.size(el.dataset.name).lines;
      let size = prefs.size(el.dataset.name);

      const move = (e) => {
        const m = gridMetrics(cards);
        const w = start.w + (e.clientX - start.x);
        const span = clamp(Math.round((w + m.gap) / (m.colWidth + m.gap)), 1, m.cols);
        const lines = clamp(Math.round(startLines + (e.clientY - start.y) / lineH), MIN_LINES, MAX_LINES);
        size = { span, lines };
        el.style.gridColumn = `span ${span}`;
        el.style.setProperty("--lines", lines);
        stickToBottom(pre);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        el.classList.remove("resizing");
        commit(size.span, size.lines);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });

    handle.addEventListener("dblclick", () => commit(1, 8));

    handle.addEventListener("keydown", (ev) => {
      const { span, lines } = prefs.size(el.dataset.name);
      const { cols } = gridMetrics(cards);
      const moves = {
        ArrowRight: [clamp(span + 1, 1, cols), lines],
        ArrowLeft: [clamp(span - 1, 1, cols), lines],
        ArrowDown: [span, clamp(lines + 2, MIN_LINES, MAX_LINES)],
        ArrowUp: [span, clamp(lines - 2, MIN_LINES, MAX_LINES)],
      };
      const m = moves[ev.key];
      if (!m) return;
      ev.preventDefault();
      commit(...m);
      announce(`Ancho ${m[0]} columna${m[0] > 1 ? "s" : ""}, ${m[1]} líneas`);
    });
  }

  function tickTimes() {
    const now = Date.now();
    for (const [id, el] of els) {
      const a = current.get(id);
      if (!a) continue;
      el.querySelector(".since").textContent = formatDuration(now - Date.parse(a.state_since));
      el.querySelector(".session").textContent = formatDuration(now - Date.parse(a.started_at));
    }
  }

  function announce(text) {
    const p = document.createElement("p");
    p.textContent = text;
    live.append(p);
    while (live.childElementCount > 5) live.firstElementChild.remove();
  }

  function rerender() {
    if (lastEvent) render({ ...lastEvent, change: { kind: "local" } });
  }

  function render(event) {
    const { agents, conn: connState, change } = event;
    lastEvent = event;
    conn.dataset.conn = connState;
    conn.querySelector(".conn-text").textContent = CONN_TEXT[connState];
    current = agents;

    if (change.kind === "snapshot") prefs.pruneDismissed(new Set(agents.keys()));
    if (change.kind === "agent_updated" && change.prev && change.prev.state !== change.agent.state) {
      announce(`${change.agent.name}: ${LABELS[change.agent.state] ?? change.agent.state}`);
    } else if (change.kind === "agent_added") {
      announce(`Nuevo agente: ${change.agent.name}`);
    }

    const visible = sortAgents([...agents.values()].filter((a) => !prefs.isDismissed(a)));
    const visibleIds = new Set(visible.map((a) => a.id));
    for (const [id, el] of els) {
      if (!visibleIds.has(id)) {
        el.remove();
        els.delete(id);
      }
    }
    visible.forEach((a, i) => {
      let el = els.get(a.id);
      if (!el) {
        el = createCard(a);
        els.set(a.id, el);
      }
      fill(el, a);
      // Reordena sin recrear nodos (mantiene el foco).
      if (cards.children[i] !== el) cards.insertBefore(el, cards.children[i] ?? null);
    });
    empty.hidden = visible.length > 0 || connState !== "open";
    tickTimes();
  }

  // Al cambiar el ancho de la ventana cambia el número de columnas: se
  // reajustan los anchos guardados para no desbordar la grilla.
  new ResizeObserver(() => {
    for (const el of els.values()) applySize(el, el.dataset.name);
  }).observe(cards);

  setInterval(tickTimes, 1000);
  return render;
}
