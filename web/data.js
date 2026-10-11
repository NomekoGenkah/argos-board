// Capa de DATOS: WebSocket + estado de agentes. No toca el DOM.
// Un renderizador (DOM hoy, canvas pixel-art mañana) se suscribe con onChange.

export function createStore() {
  const agents = new Map(); // id -> snapshot (modelo de la sección 4 de la spec)
  const listeners = new Set();
  let conn = "connecting"; // connecting | open | closed
  let serverVersion = null;

  const emit = (change) => {
    for (const fn of listeners) fn({ agents, conn, change, serverVersion });
  };

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
    }
  }

  function connect() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    let delay = 500;

    const open = () => {
      conn = "connecting";
      emit({ kind: "conn" });
      const ws = new WebSocket(url);
      ws.onopen = () => {
        delay = 500;
        conn = "open";
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
        conn = "closed";
        emit({ kind: "conn" });
        setTimeout(open, delay);
        delay = Math.min(delay * 2, 5000);
      };
    };
    open();
  }

  return {
    connect,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
