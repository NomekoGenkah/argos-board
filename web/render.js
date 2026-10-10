// Capa de RENDER (DOM). Recibe el estado de la capa de datos y lo pinta.

const LABELS = {
  working: "Trabajando",
  waiting_approval: "Esperando aprobación",
  idle: "Inactivo",
  error: "Error",
  exited: "Terminado",
  disconnected: "Desconectado",
};

const ORDER = ["waiting_approval", "error", "working", "idle", "disconnected", "exited"];

const CONN_TEXT = {
  connecting: "Conectando…",
  open: "Conectado",
  closed: "Sin conexión, reintentando…",
};

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

export function createDomRenderer({ cards, empty, conn, live, template }) {
  const els = new Map(); // id -> article
  let current = new Map();

  function fill(el, a) {
    el.dataset.state = a.state;
    el.querySelector(".name").textContent = a.name;
    el.querySelector(".badge-text").textContent = LABELS[a.state] ?? a.state;
    const project = el.querySelector(".project");
    project.textContent = shortPath(a.project) || "—";
    project.title = a.project;
    el.querySelector(".branch").textContent = a.git_branch || "—";
    const lines = a.last_lines.join("\n");
    const pre = el.querySelector(".lines");
    if (pre.textContent !== lines) pre.textContent = lines;
    el.setAttribute("aria-label", `${a.name}: ${LABELS[a.state] ?? a.state}`);
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

  function render({ agents, conn: connState, change }) {
    conn.dataset.conn = connState;
    conn.querySelector(".conn-text").textContent = CONN_TEXT[connState];
    current = agents;

    if (change.kind === "agent_updated" && change.prev && change.prev.state !== change.agent.state) {
      announce(`${change.agent.name}: ${LABELS[change.agent.state] ?? change.agent.state}`);
    } else if (change.kind === "agent_added") {
      announce(`Nuevo agente: ${change.agent.name}`);
    }

    for (const [id, el] of els) {
      if (!agents.has(id)) {
        el.remove();
        els.delete(id);
      }
    }
    const sorted = sortAgents(agents.values());
    sorted.forEach((a, i) => {
      let el = els.get(a.id);
      if (!el) {
        el = template.content.firstElementChild.cloneNode(true);
        els.set(a.id, el);
      }
      fill(el, a);
      // Reordena sin recrear nodos (mantiene el foco).
      if (cards.children[i] !== el) cards.insertBefore(el, cards.children[i] ?? null);
    });
    empty.hidden = agents.size > 0 || connState !== "open";
    tickTimes();
  }

  setInterval(tickTimes, 1000);
  return render;
}
