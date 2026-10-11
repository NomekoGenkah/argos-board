// Consola para escribir en un agente desde la página: caja de texto y teclas
// rápidas. La usan las tarjetas del tablero y el panel de la Oficina.

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

export function createConsole({ sendInput }) {
  const id = `console-${++uid}`;
  const el = document.createElement("div");
  el.className = "console";
  el.innerHTML = `
    <form class="console-form" novalidate>
      <div class="console-row">
        <textarea class="console-input" rows="1" maxlength="4000" spellcheck="false" autocomplete="off"
          placeholder="Escribe y pulsa Enter" aria-describedby="${id}-help"></textarea>
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
  const note = el.querySelector(".console-note");
  let agent = null;
  let statusTimer = null;

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

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
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
    // Sin permiso de la página, el aviso está en la cabecera (no en cada tarjeta).
    const text =
      blocker === "agent"
        ? "Este agente no acepta entrada desde la página: se lanzó con --no-input o con una versión anterior de argos-board (reinícialo)."
        : "";
    note.hidden = !text;
    note.textContent = text;
    el.hidden = blocker === "auth" || blocker === "ended";
  }

  return { el, update, focus: () => input.focus() };
}
