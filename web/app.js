import { createStore } from "./data.js";
import { createDomRenderer } from "./render.js";
import { createAlerts } from "./alerts.js";
import { prefs } from "./prefs.js";

const themeBtn = document.getElementById("theme");
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === "dark" ? "Modo claro" : "Modo oscuro";
  themeBtn.setAttribute("aria-pressed", String(t === "dark"));
}
applyTheme(prefs.theme());
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  prefs.setTheme(next);
  applyTheme(next);
});

const store = createStore();
const { render, relayout, focusAgent } = createDomRenderer({
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  conn: document.getElementById("conn"),
  live: document.getElementById("live"),
  template: document.getElementById("card-tpl"),
  prefs,
  GridStack: window.GridStack, // web/vendor/gridstack (script clásico)
  version: document.getElementById("version"),
});
document.getElementById("relayout").addEventListener("click", relayout);

const alerts = createAlerts({ prefs, baseTitle: document.title, onActivate: focusAgent });

// Botón de avisos: el permiso solo se pide con un clic explícito.
const notifyBtn = document.getElementById("notify");
function showNotifyState() {
  if (!("Notification" in window)) return; // sin soporte: el botón queda oculto
  notifyBtn.hidden = false;
  const p = Notification.permission;
  notifyBtn.disabled = p !== "default";
  notifyBtn.textContent = { granted: "Avisos activos", denied: "Avisos bloqueados", default: "Activar avisos" }[p];
  notifyBtn.title =
    p === "denied" ? "El navegador bloqueó las notificaciones de esta página; actívalas en su configuración." : "";
}
notifyBtn.addEventListener("click", async () => {
  try {
    await Notification.requestPermission();
  } finally {
    showNotifyState();
  }
});
showNotifyState();

const soundBtn = document.getElementById("sound");
function showSound() {
  const on = prefs.sound();
  soundBtn.setAttribute("aria-pressed", String(on));
  soundBtn.textContent = on ? "Sonido: sí" : "Sonido: no";
}
soundBtn.addEventListener("click", () => {
  const on = !prefs.sound();
  prefs.setSound(on);
  if (on) {
    alerts.unlockAudio();
    alerts.beep(); // muestra cómo suena
  }
  showSound();
});
// El audio necesita un gesto del usuario: el primer clic en la página lo habilita.
document.addEventListener("pointerdown", () => prefs.sound() && alerts.unlockAudio(), { once: true });
showSound();

store.onChange(render);
store.onChange(alerts.handle);
store.connect();
