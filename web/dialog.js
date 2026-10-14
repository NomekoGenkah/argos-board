// Panel de un agente (desde la Oficina): su pantalla en vivo y la consola
// para escribirle, sin salir de la vista.

import { t } from "./i18n.js";

import { createTermView } from "./term.js";
import { DEFAULT_TERM_THEME } from "./termthemes.js";
import { createConsole, inputBlocker } from "./console.js";
import { LABELS, KINDS, fillLaunch } from "./render.js";
import { wireStopButton } from "./launcher.js";

export function createAgentDialog({ dialog, sendInput, voice, uploadFile, stop, onBoard, prefs }) {
  const con = createConsole({ sendInput, voice, uploadFile });
  dialog.querySelector(".console-slot").append(con.el);
  const view = createTermView(dialog.querySelector(".term"), { theme: prefs?.termTheme() ?? DEFAULT_TERM_THEME });
  const readonly = dialog.querySelector(".dialog-readonly");
  let agentId = null;
  let last = null; // último evento de la capa de datos

  dialog.querySelector('[data-act="close"]').addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.querySelector('[data-act="board"]').addEventListener("click", () => {
    const id = agentId;
    dialog.close();
    onBoard?.(id);
  });
  dialog.addEventListener("close", () => {
    agentId = null;
    stopper.reset();
    status.textContent = "";
  });
  const status = dialog.querySelector(".dialog-status");
  const stopper = wireStopButton(dialog.querySelector('[data-act="stop"]'), {
    getAgent: () => last?.agents.get(agentId),
    stop,
    onDone: (error) => (status.textContent = error ? t("dlg.stopFailed", error) : t("dlg.stopped")),
  });
  const jumpTop = dialog.querySelector('[data-jump="top"]');
  const jumpBottom = dialog.querySelector('[data-jump="bottom"]');
  const linesCount = dialog.querySelector(".lines-count");
  jumpTop?.addEventListener("click", () => view.scrollToTop());
  jumpBottom?.addEventListener("click", () => view.scrollToBottom());

  function fill() {
    const a = last?.agents.get(agentId);
    if (!a) {
      if (dialog.open) dialog.close(); // el agente ya no está
      return;
    }
    dialog.dataset.state = a.state;
    dialog.dataset.kind = a.kind;
    const kind = dialog.querySelector(".kind");
    kind.textContent = KINDS[a.kind] ?? a.kind;
    kind.hidden = a.name.toLowerCase().includes(a.kind);
    dialog.querySelector(".name").textContent = a.name;
    dialog.querySelector(".badge-text").textContent = LABELS[a.state] ?? a.state;
    dialog.querySelector(".term").setAttribute("aria-label", t("card.terminalOf", a.name));
    view.update(a);
    if (linesCount) linesCount.textContent = t("dlg.lines", view.lineCount());
    con.update(a, last.auth);
    fillLaunch(dialog, a, last.auth);
    const why = inputBlocker(a, last.auth);
    readonly.hidden = why !== "auth";
    readonly.textContent =
      last.auth === "bad"
        ? t("dlg.readonlyBad")
        : t("dlg.readonly");
  }

  return {
    setTermTheme: (name) => view.setTheme(name),
    render(event) {
      last = event;
      if (agentId) fill();
    },
    open(id) {
      agentId = id;
      fill();
      if (!agentId) return;
      if (!dialog.open) dialog.showModal();
      view.fit();
      view.scrollToBottom();
      const a = last.agents.get(id);
      if (inputBlocker(a, last.auth) === null) con.focus();
    },
  };
}
