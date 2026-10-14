// Panel de ajustes: una hoja con la disposición, el tema, la terminal, la densidad y las esquinas,
// y los presets que juntan todo eso. Guarda en `prefs` y avisa a la página con `apply`.

import { CHOICES, DEFAULTS, KEYS, allPresets, cleanName, isBuiltin, matchingPreset, normalize, parseShared, serialize } from "./settings.js";
import { LANGS, setLangPref, storedLangPref, t } from "./i18n.js";

const LAYOUT_NOTES = {
  canvas: t("set.layoutCanvas"),
  grid: t("set.layoutGrid"),
  focus: t("set.layoutFocus"),
};

/**
 * @param canRelayout si el botón de reordenar tiene algo que hacer con estos ajustes.
 * @param apply una función por ajuste (`layout`, `theme`, `density`, `radius`, `termTheme`, `termMode`)
 *   que lo pone en la página, y `relayout` para el botón de reordenar.
 */
export function createSettingsPanel({ dialog, prefs, apply, canRelayout = (bundle) => bundle.layout === "canvas" }) {
  const $ = (sel) => dialog.querySelector(sel);
  const layoutSeg = $("#set-layout-seg");
  const selects = {
    skin: $("#set-skin"),
    termTheme: $("#term-theme"),
    termMode: $("#term-mode"),
    density: $("#set-density"),
    usage: $("#set-usage"),
    radius: $("#set-radius"),
  };
  const themeBtns = { light: $("#theme-light"), dark: $("#theme-dark") };
  // El movimiento es una preferencia de accesibilidad, no de aspecto: tampoco forma parte de un preset.
  const motionSelect = $("#set-motion");
  motionSelect.add(new Option(t("set.motionAuto"), "auto"));
  motionSelect.add(new Option(t("set.motionReduced"), "reduced"));
  motionSelect.value = prefs.motion();
  motionSelect.addEventListener("change", () => {
    prefs.setMotion(motionSelect.value);
    apply.motion?.(motionSelect.value);
  });

  // El idioma no forma parte de un preset (no es del aspecto): cambiarlo recarga la página.
  const langSelect = $("#set-lang");
  langSelect.add(new Option(t("set.langAuto"), "auto"));
  for (const [code, name] of Object.entries(LANGS)) langSelect.add(new Option(name, code));
  langSelect.value = storedLangPref();
  langSelect.addEventListener("change", () => setLangPref(langSelect.value));
  const presetSelect = $("#preset-select");
  const presetName = $("#preset-name");
  const presetJson = $("#preset-json");
  const message = $("#preset-msg");
  const relayoutBtn = $("#relayout");

  const readers = {
    skin: () => prefs.skin(),
    layout: () => prefs.layoutMode(),
    theme: () => prefs.theme(),
    density: () => prefs.density(),
    usage: () => prefs.usage(),
    radius: () => prefs.radius(),
    termTheme: () => prefs.termTheme(),
    termMode: () => prefs.termMode(),
  };
  const writers = {
    skin: (v) => prefs.setSkin(v),
    layout: (v) => prefs.setLayoutMode(v),
    theme: (v) => prefs.setTheme(v),
    density: (v) => prefs.setDensity(v),
    usage: (v) => prefs.setUsage(v),
    radius: (v) => prefs.setRadius(v),
    termTheme: (v) => prefs.setTermTheme(v),
    termMode: (v) => prefs.setTermMode(v),
  };

  /** Los ajustes de ahora (lo guardado, o el valor por defecto). */
  const current = () => normalize(Object.fromEntries(KEYS.map((k) => [k, readers[k]()])));

  function say(text, kind = "") {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  // ---- controles
  for (const [value, label] of Object.entries(CHOICES.layout)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg-btn";
    b.dataset.value = value;
    b.textContent = label;
    b.addEventListener("click", () => change("layout", value));
    layoutSeg.append(b);
  }
  for (const [key, select] of Object.entries(selects)) {
    for (const [value, label] of Object.entries(CHOICES[key])) select.add(new Option(label, value));
    select.addEventListener("change", () => change(key, select.value));
  }
  for (const [value, b] of Object.entries(themeBtns)) b.addEventListener("click", () => change("theme", value));
  relayoutBtn.addEventListener("click", () => apply.relayout?.());

  /** Un ajuste cambió desde su control. */
  function change(key, value) {
    writers[key](value);
    apply[key]?.(value);
    refresh();
  }

  /** Pone todos los ajustes de un preset. */
  function applyBundle(bundle) {
    const next = normalize(bundle);
    for (const key of KEYS) {
      writers[key](next[key]);
      apply[key]?.(next[key]);
    }
    refresh();
  }

  // ---- presets
  function refreshPresets() {
    const user = prefs.presets();
    const all = allPresets(user);
    const match = matchingPreset(all, current());
    const group = (label, names) => {
      if (!names.length) return null;
      const g = document.createElement("optgroup");
      g.label = label;
      for (const name of names) g.append(new Option(name, name));
      return g;
    };
    presetSelect.replaceChildren(
      new Option(t("set.presetNone"), ""),
      ...[
        group(t("set.presetBuiltin"), Object.keys(all).filter((n) => isBuiltin(n, user))),
        group(t("set.presetMine"), Object.keys(user)),
      ].filter(Boolean),
    );
    presetSelect.value = match ?? "";
    // Los de fábrica no se borran (solo los que guardó la persona).
    $("#preset-delete").disabled = !match || !Object.hasOwn(user, match);
  }

  presetSelect.addEventListener("change", () => {
    const bundle = allPresets(prefs.presets())[presetSelect.value];
    if (!bundle) return;
    applyBundle(bundle);
    say(t("set.presetApplied", presetSelect.value));
  });
  $("#preset-save").addEventListener("click", () => {
    const name = cleanName(presetName.value);
    if (!name) return say(t("set.presetNeedName"), "error");
    const presets = prefs.presets();
    const replaced = Object.hasOwn(presets, name);
    prefs.setPresets({ ...presets, [name]: current() });
    presetName.value = "";
    refresh();
    say(replaced ? t("set.presetUpdated", name) : t("set.presetSaved", name));
  });
  $("#preset-delete").addEventListener("click", () => {
    const name = presetSelect.value;
    if (!name || !Object.hasOwn(prefs.presets(), name)) return;
    const { [name]: _gone, ...rest } = prefs.presets();
    prefs.setPresets(rest);
    refresh();
    say(t("set.presetDeleted", name));
  });
  $("#preset-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(presetJson.value);
      say(t("set.presetCopied"));
    } catch {
      presetJson.select(); // sin permiso para el portapapeles (p. ej. por http): queda seleccionado para copiarlo a mano
      say(t("set.presetSelect"));
    }
  });
  $("#preset-apply-json").addEventListener("click", () => {
    const parsed = parseShared(presetJson.value);
    if (!parsed.ok) return say(parsed.error, "error");
    applyBundle(parsed.bundle);
    say(t("set.presetAppliedText"));
  });

  // ---- estado de los controles
  function refresh() {
    const now = current();
    for (const b of layoutSeg.children) b.setAttribute("aria-pressed", String(b.dataset.value === now.layout));
    for (const [key, select] of Object.entries(selects)) select.value = now[key];
    for (const [value, b] of Object.entries(themeBtns)) b.setAttribute("aria-pressed", String(value === now.theme));
    $("#layout-note").textContent = LAYOUT_NOTES[now.layout];
    relayoutBtn.hidden = !canRelayout(now);
    presetJson.value = serialize(now);
    refreshPresets();
  }

  $("[data-act=close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  return {
    /** Pone en la página todo lo guardado (al arrancar). */
    applyStored() {
      const now = current();
      for (const key of KEYS) apply[key]?.(now[key]);
      apply.motion?.(prefs.motion());
      refresh();
    },
    open() {
      say("");
      refresh();
      dialog.showModal();
    },
    defaults: DEFAULTS,
  };
}
