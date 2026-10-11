// Capa de DATOS: WebSocket + estado de agentes. No toca el DOM.
// Los renderizadores (tablero, oficina) y las alertas se suscriben con onChange.

const TOKEN_KEY = "argos-control-token";
const INPUT_TIMEOUT_MS = 5000;

/**
 * Token de control: llega en el enlace que imprime `argos-board serve`
 * (`#k=…`), se guarda en este navegador y se quita de la barra de direcciones.
 */
function takeToken() {
  const m = /(?:^#|&)k=([0-9a-f]{32,})/i.exec(location.hash);
  if (m) {
    try {
      localStorage.setItem(TOKEN_KEY, m[1]);
    } catch {
      /* sin almacenamiento: vale hasta recargar */
    }
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function createStore() {
  const agents = new Map(); // id -> snapshot (modelo de la sección 4 de la spec)
  const listeners = new Set();
  let conn = "connecting"; // connecting | open | closed
  let serverVersion = null;
  let token = takeToken();
  // Permiso para escribir: none (sin token) | pending | ok | bad (token rechazado).
  let auth = token ? "pending" : "none";
  let socket = null;
  let nextRid = 1;
  const pending = new Map(); // rid -> { resolve, timer }

  const emit = (change) => {
    for (const fn of listeners) fn({ agents, conn, change, serverVersion, auth });
  };

  function settle(rid, result) {
    const p = pending.get(rid);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(rid);
    p.resolve(result);
  }

  function apply(msg) {
    switch (msg.type) {
      case "snapshot":
        serverVersion = msg.server_version ?? null;
        agents.clear();
        for (const a of msg.agents) agents.set(a.id, a);
        emit({ kind: "snapshot" });
        break;
      case "agent_added":
      case "agent_updated": {
        const prev = agents.get(msg.agent.id);
        agents.set(msg.agent.id, msg.agent);
        emit({ kind: msg.type, agent: msg.agent, prev });
        break;
      }
      case "agent_removed":
        agents.delete(msg.id);
        emit({ kind: "agent_removed", id: msg.id });
        break;
      case "auth_result":
        auth = msg.ok ? "ok" : "bad";
        if (!msg.ok) {
          token = null;
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            /* nada */
          }
        }
        emit({ kind: "auth" });
        break;
      case "input_result":
        settle(msg.rid, { ok: msg.ok, error: msg.error });
        break;
    }
  }

  function connect() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    let delay = 500;

    const open = () => {
      conn = "connecting";
      emit({ kind: "conn" });
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        delay = 500;
        conn = "open";
        if (token) {
          auth = "pending";
          ws.send(JSON.stringify({ type: "auth", token }));
        }
        emit({ kind: "conn" });
      };
      ws.onmessage = (ev) => {
        try {
          apply(JSON.parse(ev.data));
        } catch (e) {
          console.error("mensaje inválido", e);
        }
      };
      ws.onclose = () => {
        socket = null;
        for (const rid of [...pending.keys()]) settle(rid, { ok: false, error: "Se cortó la conexión con el servidor" });
        conn = "closed";
        emit({ kind: "conn" });
        setTimeout(open, delay);
        delay = Math.min(delay * 2, 5000);
      };
    };
    open();
  }

  // El enlace con token puede pegarse en una pestaña ya abierta: solo cambia el "#".
  window.addEventListener("hashchange", () => {
    const fresh = takeToken();
    if (!fresh || fresh === token) return;
    token = fresh;
    if (socket?.readyState === WebSocket.OPEN) {
      auth = "pending";
      socket.send(JSON.stringify({ type: "auth", token }));
      emit({ kind: "auth" });
    }
  });

  /** Manda entrada a un agente. Resuelve con { ok, error }. */
  function sendInput(id, input) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: "Sin conexión con el servidor" });
    }
    const rid = nextRid++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(rid, { ok: false, error: "El servidor no respondió" }), INPUT_TIMEOUT_MS);
      pending.set(rid, { resolve, timer });
      socket.send(JSON.stringify({ type: "input", id, rid, input }));
    });
  }

  return {
    connect,
    sendInput,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
