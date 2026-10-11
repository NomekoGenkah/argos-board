// Preferencias de ESTE navegador (localStorage). Todo es prescindible: si el
// almacenamiento falla (modo privado, bloqueado), la página funciona igual.

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: la preferencia dura hasta recargar */
  }
}

export const DEFAULT_SIZE = { span: 1, lines: 8 };

const sizes = load("argos-sizes", {}); // nombre del agente -> { span, lines }
const dismissed = load("argos-dismissed", {}); // id -> state_since al quitarla

export const prefs = {
  theme() {
    return load("argos-theme", "light") === "dark" ? "dark" : "light";
  },
  setTheme(t) {
    save("argos-theme", t);
  },

  size(name) {
    return { ...DEFAULT_SIZE, ...(sizes[name] ?? {}) };
  },
  setSize(name, size) {
    if (size.span === DEFAULT_SIZE.span && size.lines === DEFAULT_SIZE.lines) delete sizes[name];
    else sizes[name] = { span: size.span, lines: size.lines };
    save("argos-sizes", sizes);
  },

  // Una tarjeta quitada vuelve a aparecer si el agente cambia de estado
  // (por ejemplo, si un wrapper desconectado se reconecta).
  isDismissed(agent) {
    return dismissed[agent.id] === agent.state_since;
  },
  dismiss(agent) {
    dismissed[agent.id] = agent.state_since;
    save("argos-dismissed", dismissed);
  },
  pruneDismissed(liveIds) {
    let changed = false;
    for (const id of Object.keys(dismissed)) {
      if (!liveIds.has(id)) {
        delete dismissed[id];
        changed = true;
      }
    }
    if (changed) save("argos-dismissed", dismissed);
  },
};
