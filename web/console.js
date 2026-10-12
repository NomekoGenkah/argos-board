// Consola para escribir en un agente desde la página: caja de texto, dictado por
// voz y teclas rápidas. La usan las tarjetas del tablero y el panel de la Oficina.

import { prefs } from "./prefs.js";
import { createDictation, languageChoices, voiceAvailable } from "./voice.js";

const MIC_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

// Solo se dicta en una consola a la vez.
let stopActiveDictation = null;

/** Teclas rápidas: [nombre en el protocolo, rótulo, nombre accesible]. */
export const KEYS = [
  ["up", "↑", "Flecha arriba"],
  ["down", "↓", "Flecha abajo"],
  ["enter", "Enter", "Enter"],
  ["esc", "Esc", "Escape"],
  ["tab", "Tab", "Tabulador"],
  ["ctrl_c", "Ctrl+C", "Control C: interrumpe al agente"],
];

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

export function createConsole({ sendInput, voiceLang = currentVoiceLang }) {
  const id = `console-${++uid}`;
  const el = document.createElement("div");
  el.className = "console";
  el.innerHTML = `
    <form class="console-form" novalidate>
      <div class="console-row">
        <textarea class="console-input" rows="1" maxlength="4000" spellcheck="false" autocomplete="off"
          placeholder="Escribe y pulsa Enter" aria-describedby="${id}-help"></textarea>
        <button class="console-mic" type="button" aria-pressed="false" aria-label="Dictar por voz"
          title="Dictar por voz" hidden>${MIC_ICON}</button>
        <button class="console-send" type="submit">Enviar</button>
      </div>
      <div class="console-keys" role="group" aria-label="Teclas"></div>
      <p class="console-status" role="status"></p>
      <p id="${id}-help" class="sr-only">
        Enter envía el texto; Mayúsculas y Enter agregan una línea. Con la caja vacía, las flechas
        arriba y abajo y Escape van directo al agente.
      </p>
    </form>
    <p class="console-note" hidden></p>`;
  const form = el.querySelector(".console-form");
  const input = el.querySelector(".console-input");
  const keys = el.querySelector(".console-keys");
  const status = el.querySelector(".console-status");
  const mic = el.querySelector(".console-mic");
  const note = el.querySelector(".console-note");
  let agent = null;
  let statusTimer = null;
  let dictationFailed = false; // un error de voz no se tapa con el aviso de «listo»

  for (const [key, label, name] of KEYS) {
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
  const dictation = createDictation({
    lang: voiceLang,
    onText: (text) => {
      input.value = text;
      grow();
    },
    onState: (on) => {
      mic.setAttribute("aria-pressed", String(on));
      mic.title = on ? "Dejar de dictar" : "Dictar por voz";
      if (on) {
        dictationFailed = false;
        show("Escuchando… habla y pulsa el micrófono para terminar", "info");
      } else {
        if (stopActiveDictation === dictation.stop) stopActiveDictation = null;
        if (!dictationFailed) show(input.value ? "Dictado listo: revisa y envía" : "", input.value ? "ok" : "info");
        input.focus();
      }
    },
    onError: (message) => {
      dictationFailed = true;
      show(message, "error");
    },
  });
  if (voiceAvailable()) {
    mic.hidden = false;
    mic.addEventListener("click", () => {
      if (dictation.listening) {
        dictation.stop();
        return;
      }
      stopActiveDictation?.();
      stopActiveDictation = dictation.stop;
      dictation.start(input.value);
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await dictation.stop(); // lo ya dicho queda en la caja antes de leerla
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
    if (blocker !== null) dictation.stop();
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
