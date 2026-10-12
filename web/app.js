import { createStore } from "./data.js";
import { createDomRenderer } from "./render.js";
import { createAlerts } from "./alerts.js";
import { createOfficeRenderer } from "./office.js";
import { createAgentDialog } from "./dialog.js";
import { createLaunchDialog } from "./launcher.js";
import { currentVoiceLang } from "./console.js";
import { createPairDialog } from "./pairing.js";
import { languageChoices, voiceAvailable } from "./voice.js";
import { prefs } from "./prefs.js";

// Tema: selector Claro | Oscuro (actúa como switch: cualquier clic alterna el tema).
const themeBtns = { light: document.getElementById("theme-light"), dark: document.getElementById("theme-dark") };
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  for (const [k, b] of Object.entries(themeBtns)) b.setAttribute("aria-pressed", String(k === t));
}
applyTheme(prefs.theme());
function toggleTheme() {
  const next = prefs.theme() === "dark" ? "light" : "dark";
  prefs.setTheme(next);
  applyTheme(next);
  document.querySelectorAll(".lines").forEach((pre) => {
    delete pre.dataset.raw;
  });
  window.dispatchEvent(new CustomEvent("argos:theme-change"));
}
themeBtns.light?.closest(".seg")?.addEventListener("click", toggleTheme);

const store = createStore();

// En la Oficina y en el Tablero, se puede abrir el panel completo (pantalla + consola).
const agentDialog = createAgentDialog({
  dialog: document.getElementById("agent-dialog"),
  sendInput: store.sendInput,
  voice: store.voice,
  stop: store.stop,
  onBoard: (id) => openInBoard(id),
});

const { render, relayout, focusAgent } = createDomRenderer({
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  conn: document.getElementById("conn"),
  live: document.getElementById("live"),
  template: document.getElementById("card-tpl"),
  prefs,
  GridStack: window.GridStack, // web/vendor/gridstack (script clásico)
  version: document.getElementById("version"),
  sendInput: store.sendInput,
  voice: store.voice,
  stop: store.stop,
  onOpenAgent: (id) => agentDialog.open(id),
});

// Dos vistas de los mismos datos: el Tablero (tarjetas) y la Oficina (pixel-art).
const cardsEl = document.getElementById("cards");
const officeEl = document.getElementById("office");
const viewBtns = { board: document.getElementById("view-board"), office: document.getElementById("view-office") };
const relayoutBtn = document.getElementById("relayout");
let view = prefs.view();
const office = createOfficeRenderer({ root: officeEl, prefs, onOpen: (id) => agentDialog.open(id) });

function setView(v, { save = true } = {}) {
  view = v;
  if (save) prefs.setView(v);
  cardsEl.hidden = v !== "board";
  officeEl.hidden = v !== "office";
  for (const [k, b] of Object.entries(viewBtns)) b.setAttribute("aria-pressed", String(k === v));
  relayoutBtn.title =
    v === "board" ? "Ordena las tarjetas por estado y restablece su tamaño" : "Ordena los escritorios por estado";
  office.setActive(v === "office");
}
function openInBoard(id) {
  setView("board");
  requestAnimationFrame(() => focusAgent(id));
}
function toggleView() {
  setView(view === "board" ? "office" : "board");
}
viewBtns.board?.closest(".seg")?.addEventListener("click", toggleView);
relayoutBtn.addEventListener("click", () => (view === "board" ? relayout() : office.relayout()));
setView(view, { save: false });

const alerts = createAlerts({
  prefs,
  baseTitle: document.title,
  onActivate: (id) => (view === "board" ? focusAgent(id) : office.focusAgent(id)),
});

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

// Idioma del dictado por voz del NAVEGADOR (el transcriptor del servidor no lo usa): solo se
// muestra si se dictaría con el navegador (contexto seguro + reconocedor y sin transcriptor).
const voiceLangBtn = document.getElementById("voice-lang");
const showVoiceLang = () => {
  voiceLangBtn.hidden = store.voice.available() || !voiceAvailable();
  voiceLangBtn.textContent = `Voz: ${currentVoiceLang()}`;
};
voiceLangBtn.addEventListener("click", () => {
  const choices = languageChoices(navigator.language);
  prefs.setVoiceLang(choices[(choices.indexOf(currentVoiceLang()) + 1) % choices.length]);
  showVoiceLang();
});

// Permiso para escribir: aviso en la cabecera (no en cada tarjeta).
const writeBtn = document.getElementById("write");
const writeDialog = document.getElementById("write-dialog");
const WRITE_TEXT = {
  none: ["Solo lectura", "Esta página todavía no tiene permiso para escribir en los agentes."],
  bad: ["Token inválido", "El token guardado ya no es válido (¿se renovó?). Abre el enlace nuevo."],
  pair: ["Sin emparejar", "Este dispositivo no está emparejado: ingresa un código de `argos-board pair` para ver y controlar los agentes."],
  pending: ["Solo lectura", "Comprobando el permiso para escribir…"],
  ok: ["Escritura activa", "Esta página puede escribir en los agentes que lo permiten."],
};
let lastAuth = null;
function showWrite({ auth }) {
  if (auth === lastAuth) return;
  lastAuth = auth;
  const [label, text] = WRITE_TEXT[auth] ?? WRITE_TEXT.none;
  writeBtn.hidden = false;
  writeBtn.textContent = label;
  writeBtn.dataset.auth = auth;
  writeDialog.querySelector(".write-dialog-text").textContent = text;
}
writeBtn.addEventListener("click", () => writeDialog.showModal());

// Nuevo agente: al aparecer su tarjeta (o su mascota), se enfoca.
let focusWhenSeen = null;
let lastEvent = null;
const launchDialog = createLaunchDialog({
  dialog: document.getElementById("launch-dialog"),
  store,
  onLaunched: (name) => {
    focusWhenSeen = name;
    if (lastEvent) afterLaunch(lastEvent); // pudo aparecer antes que la respuesta
  },
});
const launchBtn = document.getElementById("launch");
launchBtn.addEventListener("click", () => launchDialog.open());
function afterLaunch(event) {
  lastEvent = event;
  const { agents } = event;
  launchBtn.hidden = !launchDialog.available();
  if (!focusWhenSeen) return;
  const a = [...agents.values()].find((x) => x.name === focusWhenSeen && x.state !== "exited");
  if (!a) return;
  focusWhenSeen = null;
  requestAnimationFrame(() => (view === "board" ? focusAgent(a.id) : office.focusAgent(a.id)));
}

store.onChange(render);
store.onChange(office.render);
store.onChange(launchDialog.render);
store.onChange(afterLaunch);
store.onChange(agentDialog.render);
store.onChange(showWrite);
store.onChange(showVoiceLang);
const pairDialog = createPairDialog({ dialog: document.getElementById("pair-dialog"), store });
store.onChange(pairDialog.render);
store.onChange(alerts.handle);
store.connect();
