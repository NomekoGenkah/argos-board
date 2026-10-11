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

const layouts = load("argos-layout", {}); // nombre del agente -> { x, y, w, h }
const dismissed = load("argos-dismissed", {}); // id -> state_since al quitarla
try {
  localStorage.removeItem("argos-sizes"); // formato anterior a gridstack
} catch {
  /* nada */
}

export const prefs = {
  theme() {
    return load("argos-theme", "light") === "dark" ? "dark" : "light";
  },
  setTheme(t) {
    save("argos-theme", t);
  },

  // Posición y tamaño de la tarjeta en el lienzo, por nombre de agente (el id
  // cambia en cada sesión; el nombre se mantiene).
  layout(name) {
    return layouts[name] ?? null;
  },
  setLayouts(entries) {
    for (const [name, l] of entries) layouts[name] = { x: l.x, y: l.y, w: l.w, h: l.h };
    save("argos-layout", layouts);
  },
  clearLayouts() {
    for (const k of Object.keys(layouts)) delete layouts[k];
    save("argos-layout", layouts);
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
