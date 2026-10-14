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
import { NEEDS_YOU } from "./alerts.js";
import { createSettingsPanel } from "./settings-panel.js";
import { createUsageBar } from "./usage.js";
import { applyDom, t } from "./i18n.js";

applyDom();

// Aspecto: el tema, la densidad y las esquinas son atributos de <html>; los pone el panel de ajustes.
const root = document.documentElement;
function applyTheme(t) {
  root.dataset.theme = t;
  window.dispatchEvent(new CustomEvent("argos:theme-change"));
}

const store = createStore();

// En la Oficina y en el Tablero, se puede abrir el panel completo (pantalla + consola).
const agentDialog = createAgentDialog({
  dialog: document.getElementById("agent-dialog"),
  sendInput: store.sendInput,
  voice: store.voice,
  uploadFile: store.uploadFile,
  stop: store.stop,
  onBoard: (id) => openInBoard(id),
  prefs,
});

const { render, relayout, focusAgent, setTermTheme, setTermMode, setLayout } = createDomRenderer({
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
  uploadFile: store.uploadFile,
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
  relayoutBtn.textContent = v === "board" ? t("set.relayout") : t("set.relayoutOffice");
  relayoutBtn.title = v === "board" ? t("set.relayoutTitle") : t("set.relayoutOfficeTitle");
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
setView(view, { save: false });

const usageBar = createUsageBar({ root: document.getElementById("usage"), store });
store.onChange((e) => usageBar.onChange(e));

// Ajustes: disposición, tema, terminal, densidad, esquinas y presets (hoja a la derecha).
const settings = createSettingsPanel({
  dialog: document.getElementById("settings-dialog"),
  prefs,
  canRelayout: (bundle) => view === "office" || bundle.layout === "canvas",
  apply: {
    layout: setLayout,
    theme: applyTheme,
    density: (v) => (root.dataset.density = v),
    usage: (v) => usageBar.setEnabled(v === "on"),
    radius: (v) => (root.dataset.radius = v),
    termTheme: (v) => {
      setTermTheme(v);
      agentDialog.setTermTheme(v);
    },
    termMode: setTermMode,
    relayout: () => (view === "board" ? relayout() : office.relayout()),
  },
});
settings.applyStored();
document.getElementById("settings").addEventListener("click", () => settings.open());

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
  notifyBtn.textContent = { granted: t("notify.on"), denied: t("notify.denied"), default: t("notify.enable") }[p];
  notifyBtn.title =
    p === "denied" ? t("notify.deniedTitle") : "";
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
  soundBtn.textContent = on ? t("sound.on") : t("sound.off");
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
  voiceLangBtn.textContent = t("voice.lang", currentVoiceLang());
};
voiceLangBtn.addEventListener("click", () => {
  const choices = languageChoices(navigator.language);
  prefs.setVoiceLang(choices[(choices.indexOf(currentVoiceLang()) + 1) % choices.length]);
  showVoiceLang();
});

// Permiso para escribir: aviso en la cabecera (no en cada tarjeta).
const writeBtn = document.getElementById("write");
const writeDialog = document.getElementById("write-dialog");
const WRITE_TEXT = Object.fromEntries(
  ["none", "bad", "pair", "pending", "ok"].map((k) => [k, [t(`write.${k}`), t(`write.${k}Text`)]]),
);
let lastAuth = null;
function showWrite({ auth }) {
  if (auth === lastAuth) return;
  lastAuth = auth;
  const [label, text] = WRITE_TEXT[auth] ?? WRITE_TEXT.none;
  writeBtn.hidden = false;
  writeBtn.querySelector(".write-text").textContent = label;
  writeBtn.title = text;
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

// Lo que te espera, siempre a la vista: al pulsarlo se va al agente que lleva más tiempo esperando.
const attentionBtn = document.getElementById("attention");
let attentionTarget = null;
function showAttention({ agents }) {
  const list = [...agents.values()];
  const waiting = list.filter((a) => NEEDS_YOU.has(a.state)).sort((a, b) => Date.parse(a.state_since) - Date.parse(b.state_since));
  const errors = list.filter((a) => a.state === "error").length;
  const working = list.filter((a) => a.state === "working").length;
  let level = "calm";
  let text = list.length ? t("attention.calm") : t("attention.none");
  if (waiting.length) [level, text] = ["wait", t("attention.wait", waiting.length)];
  else if (errors) [level, text] = ["error", t("attention.error", errors)];
  else if (working) [level, text] = ["work", t("attention.work", working)];
  attentionTarget = waiting[0]?.id ?? null;
  attentionBtn.dataset.level = level;
  attentionBtn.textContent = text;
  attentionBtn.disabled = !attentionTarget;
  attentionBtn.title = attentionTarget ? t("attention.go", waiting[0].name) : "";
}
attentionBtn.addEventListener("click", () => {
  if (attentionTarget) view === "board" ? focusAgent(attentionTarget) : office.focusAgent(attentionTarget);
});
store.onChange(showAttention);

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
