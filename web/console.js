// Consola para escribir en un agente desde la página: caja de texto, dictado por
// voz y teclas rápidas. La usan las tarjetas del tablero y el panel de la Oficina.

import { prefs } from "./prefs.js";
import { micErrorText, openMic } from "./mic.js";
import { createDictation, createServerDictation, languageChoices, voiceAvailable } from "./voice.js";

const MIC_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

const ATTACH_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3.5 3.5 0 0 0 7 0V5a4.5 4.5 0 0 0-9 0v12.5c0 3.31 2.69 6 6 6s6-2.69 6-6V6h-1.5z"/></svg>';

// Solo se dicta en una consola a la vez.
let stopActiveDictation = null;

/** Teclas rápidas: [nombre en el protocolo, rótulo, nombre accesible]. */
export const KEYS = [
  ["up", "↑", "Flecha arriba"],
  ["down", "↓", "Flecha abajo"],
  ["enter", "Enter", "Enter"],
  ["esc", "Esc", "Escape"],
  ["tab", "Tab", "Tabulador"],
  ["shift_tab", "⇧Tab", "Shift Tab: alternar modo o permisos"],
  ["ctrl_c", "Ctrl+C", "Control C: interrumpe al agente"],
];

/** Comandos rápidos de modo por tipo de agente. */
const MODE_COMMANDS = {
  claude: [
    { label: "/plan", text: "/plan", name: "Modo Plan (/plan)" },
  ],
  copilot: [
    { label: "/plan", text: "/plan", name: "Modo Plan (/plan)" },
    { label: "/autopilot", text: "/autopilot", name: "Modo Autopilot (/autopilot)" },
  ],
  opencode: [
    { label: "Plan", text: "/mode plan", name: "Modo Plan (/mode plan)" },
  ],
  agy: [
    { label: "/plan", text: "/plan", name: "Modo Plan (/plan)" },
    { label: "/auto", text: "/auto", name: "Modo Auto (/auto)" },
  ],
};

// Con la caja vacía, estas teclas van directo al agente (para moverse en sus menús).
const PASS_THROUGH = { ArrowUp: "up", ArrowDown: "down", Escape: "esc" };

const ENDED = new Set(["exited", "disconnected"]);

/** Por qué no se puede escribir en este agente ahora (o null si se puede). */
export function inputBlocker(agent, auth) {
  if (auth !== "ok") return "auth";
  if (ENDED.has(agent.state)) return "ended";
  if (!agent.accepts_input) return "agent";
  return null;
}

let uid = 0;

/** Idioma del dictado: el elegido en la cabecera o, si no, el del navegador. */
export function currentVoiceLang() {
  const choices = languageChoices(navigator.language);
  const chosen = prefs.voiceLang();
  return chosen && choices.includes(chosen) ? chosen : (choices[0] ?? "es-CL");
}

const PHASE_TEXT = {
  preparing: "Preparando el micrófono… (la primera vez tarda unos segundos)",
  listening: "Escuchando… habla y pulsa el micrófono para terminar",
  finishing: "Terminando de transcribir…",
};

/** ¿Se puede dictar aquí? Con el servidor (cualquier navegador) o con el del navegador. */
export const voiceUsable = (voice) => Boolean(voice?.available()) || voiceAvailable();

export function createConsole({ sendInput, voice = null, voiceLang = currentVoiceLang, uploadFile = null }) {
  const id = `console-${++uid}`;
  const el = document.createElement("div");
  el.className = "console";
  el.innerHTML = `
    <form class="console-form" novalidate>
      <div class="console-row">
        <textarea class="console-input" rows="1" maxlength="131072" spellcheck="false" autocomplete="off"
          placeholder="Escribe y pulsa Enter" aria-describedby="${id}-help"></textarea>
        <input type="file" class="console-file" accept=".md,.markdown,.txt,.json,.csv,.py,.rs,.js,.ts,.html,.css,.png,.jpg,.jpeg,.webp,.gif,text/*,image/*" hidden>
        <button class="console-attach" type="button" aria-label="Adjuntar archivo o imagen"
          title="Adjuntar archivo o imagen (.md, imágenes, etc.)">${ATTACH_ICON}</button>
        <button class="console-mic" type="button" aria-pressed="false" aria-label="Dictar por voz"
          title="Dictar por voz" hidden>${MIC_ICON}</button>
        <button class="console-send" type="submit">Enviar</button>
      </div>
      <div class="console-keys" role="group" aria-label="Teclas"></div>
      <p class="console-status" role="status"></p>
      <p id="${id}-help" class="sr-only">
        Enter envía el texto; Mayúsculas y Enter agregan una línea. Con la caja vacía, las flechas
        arriba y abajo y Escape van directo al agente. Puedes arrastrar o adjuntar archivos (.md, imágenes).
      </p>
    </form>
    <p class="console-note" hidden></p>`;
  const form = el.querySelector(".console-form");
  const input = el.querySelector(".console-input");
  const fileInput = el.querySelector(".console-file");
  const attachBtn = el.querySelector(".console-attach");
  const keys = el.querySelector(".console-keys");
  const status = el.querySelector(".console-status");
  const mic = el.querySelector(".console-mic");
  const note = el.querySelector(".console-note");
  let agent = null;
  let statusTimer = null;
  let dictationFailed = false; // un error de voz no se tapa con el aviso de «listo»
  const modesWrap = document.createElement("span");
  modesWrap.className = "console-modes";

  for (const [key, label, name] of KEYS) {
    if (key === "ctrl_c") {
      keys.append(modesWrap);
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "key";
    b.dataset.key = key;
    b.textContent = label;
    b.setAttribute("aria-label", name);
    b.addEventListener("click", () => send({ type: "key", key }, name));
    keys.append(b);
  }

  function show(text, kind) {
    clearTimeout(statusTimer);
    status.textContent = text;
    status.dataset.kind = kind;
    if (kind === "ok") statusTimer = setTimeout(() => (status.textContent = ""), 1800);
  }

  async function send(inputMsg, what) {
    if (!agent) return false;
    const res = await sendInput(agent.id, inputMsg);
    if (res.ok) show(`${what} ✓`, "ok");
    else show(res.error || "No se pudo enviar", "error");
    return res.ok;
  }

  function grow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  }

  // Dictado por voz: lo dicho se escribe en la caja; se revisa y se envía como cualquier texto.
  // Con transcriptor en el servidor (agy) sirve en cualquier navegador; si no, el del navegador.
  const handlers = {
    onText: (text) => {
      input.value = text;
      grow();
    },
    onState: (on) => {
      mic.setAttribute("aria-pressed", String(on));
      mic.title = on ? "Dejar de dictar" : "Dictar por voz";
      if (on) {
        dictationFailed = false;
        show(PHASE_TEXT.listening, "info");
      } else {
        if (stopActiveDictation === current?.stop) stopActiveDictation = null;
        if (!dictationFailed) show(input.value ? "Dictado listo: revisa y envía" : "", input.value ? "ok" : "info");
        input.focus();
      }
    },
    onPhase: (phase) => show(PHASE_TEXT[phase] ?? "", "info"),
    onError: (message) => {
      dictationFailed = true;
      show(message, "error");
    },
  };
  const engines = {
    browser: createDictation({ lang: voiceLang, ...handlers }),
    server: voice ? createServerDictation({ voice, openMic, micErrorText, ...handlers }) : null,
  };
  let current = null; // el motor que está dictando ahora
  mic.addEventListener("click", () => {
    if (current?.listening) {
      current.stop();
      return;
    }
    stopActiveDictation?.();
    current = voice?.available() ? engines.server : engines.browser;
    stopActiveDictation = current.stop;
    current.start(input.value);
  });

  async function handleFile(file) {
    if (!agent) return;
    if (!uploadFile) {
      show("Subida de archivos no disponible", "error");
      return;
    }
    show(`Subiendo ${file.name}…`, "info");
    const res = await uploadFile(agent.id, file);
    if (!res.ok) {
      show(res.error || "No se pudo subir el archivo", "error");
      return;
    }
    const ref = `@${res.relative_path}`;
    const cur = input.value;
    input.value = cur ? `${cur.trimEnd()} ${ref} ` : `${ref} `;
    grow();
    input.focus();
    if (res.is_image) {
      show(`Imagen adjuntada: ${ref} (comprueba si el modelo soporta visión)`, "info");
    } else {
      show(`Adjuntado: ${ref} ✓`, "ok");
    }
  }

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
    fileInput.value = "";
  });

  el.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    el.classList.add("dragover");
  });
  el.addEventListener("dragleave", (ev) => {
    if (!el.contains(ev.relatedTarget)) el.classList.remove("dragover");
  });
  el.addEventListener("drop", (ev) => {
    ev.preventDefault();
    el.classList.remove("dragover");
    const file = ev.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  input.addEventListener("paste", (ev) => {
    const files = ev.clipboardData?.files;
    if (files && files.length > 0) {
      ev.preventDefault();
      handleFile(files[0]);
    }
  });

  function updateModes(kind) {
    modesWrap.replaceChildren();
    const cmds = MODE_COMMANDS[kind] || [];
    for (const item of cmds) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key key-mode";
      b.textContent = item.label;
      b.setAttribute("aria-label", item.name);
      b.title = item.name;
      b.addEventListener("click", () => send({ type: "text", text: item.text, submit: true }, item.name));
      modesWrap.append(b);
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await current?.stop(); // lo ya dicho queda en la caja antes de leerla
    const text = input.value;
    if (await send({ type: "text", text, submit: true }, text ? "Enviado" : "Enter")) {
      input.value = "";
      grow();
    }
  });
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (ev) => {
    // Que el lienzo (atajos de la tarjeta) no reciba lo que se escribe aquí.
    ev.stopPropagation();
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
      return;
    }
    const key = PASS_THROUGH[ev.key];
    if (key && input.value === "" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault(); // Escape no cierra el panel: va al agente
      send({ type: "key", key }, KEYS.find(([k]) => k === key)[2]);
    }
  });

  /** Muestra la consola o, si no se puede escribir, por qué. */
  function update(next, auth) {
    agent = next;
    input.setAttribute("aria-label", `Escribir a ${next.name}`);
    const blocker = inputBlocker(next, auth);
    form.hidden = blocker !== null;
    if (blocker !== null) current?.stop();
    mic.hidden = !voiceUsable(voice);
    attachBtn.hidden = !uploadFile;
    updateModes(next.kind);
    // Sin permiso de la página, el aviso está en la cabecera (no en cada tarjeta).
    const text =
      blocker === "agent"
        ? "No acepta entrada desde la página (--no-input o versión anterior)."
        : "";
    note.hidden = !text;
    note.textContent = text;
    el.hidden = blocker === "auth" || blocker === "ended";
  }

  return { el, update, focus: () => input.focus() };
}
