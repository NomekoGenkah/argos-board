// Lanzar agentes desde la página: el diálogo "Nuevo agente" (tipo, carpeta y
// nombre) y el botón "Detener" de los agentes lanzados así.

import { KINDS } from "./render.js";

const KIND_ORDER = ["claude", "opencode", "agy", "copilot"];

/** Carpetas recientes: los proyectos de los agentes a la vista, sin repetir y dentro de las raíces. */
export function recentFolders(agents, roots = [], limit = 6) {
  const seen = new Set();
  const inside = (p) => roots.some((r) => p === r || p.startsWith(r.endsWith("/") ? r : `${r}/`));
  return [...agents.values()]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map((a) => a.project)
    .filter((p) => p && inside(p) && !seen.has(p) && seen.add(p))
    .slice(0, limit);
}

export function createLaunchDialog({ dialog, store, onLaunched }) {
  const form = dialog.querySelector("form");
  const kinds = dialog.querySelector(".launch-kinds");
  const recent = dialog.querySelector(".launch-recent");
  const recentWrap = dialog.querySelector(".launch-recent-wrap");
  const current = dialog.querySelector(".launch-path");
  const up = dialog.querySelector(".launch-up");
  const list = dialog.querySelector(".launch-dirs");
  const nameInput = dialog.querySelector(".launch-name");
  const note = dialog.querySelector(".launch-note");
  const status = dialog.querySelector(".launch-status");
  const submit = dialog.querySelector('[type="submit"]');
  let last = null; // último evento de la capa de datos
  let path = null;
  let parent = null;

  const say = (text, kind = "") => {
    status.textContent = text;
    status.dataset.kind = kind;
  };
  const selectedKind = () => form.elements.kind?.value || null;
  const folderName = (p) => p.split("/").filter(Boolean).pop() ?? "/";

  function updatePlaceholder() {
    const k = selectedKind();
    nameInput.placeholder = k && path ? `${k}@${folderName(path)}` : "";
  }

  async function go(target) {
    const res = await store.listDirs(target);
    if (!res.ok) {
      say(res.error || "No se pudo abrir la carpeta", "error");
      return;
    }
    say("");
    path = res.path;
    parent = res.parent;
    current.textContent = path;
    up.disabled = !parent;
    list.replaceChildren(
      ...res.dirs.map((d) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "launch-dir";
        b.textContent = d;
        b.setAttribute("aria-label", `Entrar en ${d}`);
        b.addEventListener("click", () => go(`${path.replace(/\/$/, "")}/${d}`));
        li.append(b);
        return li;
      }),
    );
    if (!res.dirs.length) {
      const li = document.createElement("li");
      li.className = "launch-empty";
      li.textContent = "Sin subcarpetas";
      list.append(li);
    }
    updatePlaceholder();
  }

  up.addEventListener("click", () => parent && go(parent));
  form.addEventListener("change", updatePlaceholder);
  dialog.querySelector('[data-act="cancel"]').addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const kind = selectedKind();
    if (!kind) return say("Elige un agente", "error");
    if (!path) return say("Elige una carpeta", "error");
    submit.disabled = true;
    say("Lanzando…");
    const res = await store.launch(kind, path, nameInput.value.trim());
    submit.disabled = false;
    if (!res.ok) return say(res.error || "No se pudo lanzar", "error");
    dialog.close();
    onLaunched?.(res.name);
  });

  function fillKinds(info) {
    const available = KIND_ORDER.filter((k) => info.kinds.includes(k));
    kinds.replaceChildren(
      ...available.map((k, i) => {
        const label = document.createElement("label");
        label.className = "launch-kind";
        label.dataset.kind = k;
        label.innerHTML = '<input type="radio" name="kind"><span class="dot" aria-hidden="true"></span><span></span>';
        const input = label.querySelector("input");
        input.value = k;
        input.checked = i === 0;
        label.lastElementChild.textContent = KINDS[k] ?? k;
        return label;
      }),
    );
    note.textContent = info.tmux
      ? "Corre en una sesión de tmux: además de verlo aquí, podrás tomarlo desde una terminal."
      : "Sin tmux: el agente solo existirá en esta página (y se cierra si se detiene argos-board serve).";
  }

  function fillRecent() {
    const folders = recentFolders(last?.agents ?? new Map(), last?.launchInfo?.roots ?? []);
    recentWrap.hidden = !folders.length;
    recent.replaceChildren(
      ...folders.map((p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "launch-chip";
        b.textContent = folderName(p);
        b.title = p;
        b.setAttribute("aria-label", `Usar ${p}`);
        b.addEventListener("click", () => go(p));
        return b;
      }),
    );
  }

  return {
    render(event) {
      last = event;
    },
    /** Hay algo que lanzar y permiso para hacerlo. */
    available() {
      return last?.auth === "ok" && Boolean(last?.launchInfo?.kinds.length);
    },
    async open() {
      if (!this.available()) return;
      fillKinds(last.launchInfo);
      fillRecent();
      nameInput.value = "";
      say("");
      dialog.showModal();
      await go(path); // la última carpeta usada (o la primera permitida)
      form.querySelector('input[name="kind"]:checked')?.focus();
    },
  };
}

/**
 * Botón "Detener" de dos pasos (el primer clic pide confirmación).
 * `getAgent()` devuelve el agente actual; `onDone(error)` informa el resultado.
 */
export function wireStopButton(button, { getAgent, stop, onDone }) {
  let armed = null;
  const reset = () => {
    clearTimeout(armed);
    armed = null;
    button.textContent = "Detener";
    button.dataset.armed = "";
  };
  button.addEventListener("click", async () => {
    const a = getAgent();
    if (!a) return;
    if (!armed) {
      button.textContent = "¿Detener?";
      button.dataset.armed = "1";
      armed = setTimeout(reset, 3000);
      return;
    }
    reset();
    button.disabled = true;
    const res = await stop(a.id);
    button.disabled = false;
    onDone?.(res.ok ? null : res.error || "No se pudo detener");
  });
  reset();
  return { reset };
}

/** Texto para un agente lanzado desde la página. */
export function launchText(agent) {
  if (!agent.launch) return null;
  return agent.launch.attach
    ? { text: "En tmux:", code: agent.launch.attach }
    : { text: "Lanzado desde la página (solo existe aquí).", code: null };
}
