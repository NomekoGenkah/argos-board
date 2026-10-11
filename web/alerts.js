// ALERTAS: otro consumidor de la capa de datos, independiente del render.
// Cuando un agente pasa a esperar al usuario: notificación del navegador,
// sonido opcional y contador en el título de la pestaña.

export const NEEDS_YOU = new Set(["waiting_input", "waiting_approval"]);

const WHAT = {
  waiting_input: "te hizo una pregunta",
  waiting_approval: "pide permiso",
};

const SESSION_KEY = "argos-notified";

/** Clave de un evento de espera: una por transición, no por mensaje. */
export const eventKey = (a) => `${a.id}|${a.state}|${a.state_since}`;

function loadNotified() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

export function createAlerts({ prefs, baseTitle, onActivate }) {
  // Eventos ya avisados en esta pestaña (sobrevive a recargas, no a otras pestañas).
  const notified = loadNotified();
  let sawFirstSnapshot = false;
  let audio = null;

  const save = () => {
    try {
      // Solo se guardan los últimos 200 para no crecer sin límite.
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...notified].slice(-200)));
    } catch {
      /* sin almacenamiento: puede repetirse un aviso tras recargar */
    }
  };

  function beep() {
    if (!audio) return;
    try {
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(660, t + 0.12);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    } catch {
      /* sin audio */
    }
  }

  function notify(a) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const n = new Notification(`${a.name} ${WHAT[a.state]}`, {
        body: a.project,
        tag: a.id, // una notificación viva por agente
        renotify: true,
      });
      n.onclick = () => {
        window.focus();
        onActivate?.(a.id);
        n.close();
      };
    } catch {
      /* algunos navegadores solo permiten notificaciones desde un service worker */
    }
  }

  function handle({ agents, change }) {
    const waiting = [...agents.values()].filter((a) => NEEDS_YOU.has(a.state));
    document.title = waiting.length ? `(${waiting.length}) ${baseTitle}` : baseTitle;
    if (change.kind === "conn" || change.kind === "local") return;

    // Al abrir la página no se avisa de lo que ya estaba esperando: el
    // contador del título ya lo muestra. Tras reconectar sí (pudo pasar algo).
    const silent = change.kind === "snapshot" && !sawFirstSnapshot;
    if (change.kind === "snapshot") sawFirstSnapshot = true;

    const fresh = waiting.filter((a) => !notified.has(eventKey(a)));
    if (!fresh.length) return;
    for (const a of fresh) notified.add(eventKey(a));
    save();
    if (silent) return;
    fresh.forEach(notify);
    if (prefs.sound()) beep();
  }

  return {
    handle,
    /** Debe llamarse desde un gesto del usuario (los navegadores lo exigen). */
    unlockAudio() {
      try {
        audio ??= new AudioContext();
        audio.resume?.();
      } catch {
        audio = null;
      }
    },
    beep,
  };
}
