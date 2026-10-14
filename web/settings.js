// Ajustes de aspecto: qué valores existen, sus valores por defecto y cómo se guardan y comparten
// como preset. Sin DOM: lo usan el panel de ajustes y las pruebas.

import { DEFAULT_TERM_MODE, TERM_MODES } from "./termgrid.js";
import { t } from "./i18n.js";
import { DEFAULT_TERM_THEME, TERM_THEMES } from "./termthemes.js";

/** Valores válidos de cada ajuste y cómo se llaman en la página. */
export const CHOICES = {
  layout: { canvas: t("choice.canvas"), grid: t("choice.grid"), focus: t("choice.focus") },
  theme: { light: t("choice.light"), dark: t("choice.dark") },
  density: { comfortable: t("choice.comfortable"), compact: t("choice.compact") },
  usage: { on: t("choice.on"), off: t("choice.off") },
  radius: { sharp: t("choice.sharp"), soft: t("choice.soft"), round: t("choice.round") },
  termTheme: Object.fromEntries(Object.entries(TERM_THEMES).map(([k, t]) => [k, t.label])),
  termMode: TERM_MODES,
};

export const DEFAULTS = {
  layout: "canvas",
  theme: "light",
  density: "comfortable",
  usage: "on",
  radius: "soft",
  termTheme: DEFAULT_TERM_THEME,
  termMode: DEFAULT_TERM_MODE,
};

export const KEYS = Object.keys(DEFAULTS);

/** Un valor válido por cada ajuste: lo que venga bien, y si no, el de `base`. */
export function normalize(raw, base = DEFAULTS) {
  const out = {};
  for (const key of KEYS) {
    const v = raw?.[key];
    out[key] = typeof v === "string" && Object.hasOwn(CHOICES[key], v) ? v : base[key];
  }
  return out;
}

/** El texto con el que se comparte un preset. */
export function serialize(bundle) {
  return JSON.stringify({ argos: 1, ...normalize(bundle) }, null, 2);
}

/** Lee un preset compartido como texto. */
export function parseShared(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: t("set.presetBadText") };
  }
  if (!raw || typeof raw !== "object" || raw.argos !== 1) {
    return { ok: false, error: t("set.presetNotArgos") };
  }
  if (!KEYS.some((k) => Object.hasOwn(raw, k))) return { ok: false, error: t("set.presetEmpty") };
  return { ok: true, bundle: normalize(raw) };
}

const MAX_NAME = 40;

/** Nombre de preset sin espacios de más y de largo razonable; vacío si no sirve. */
export function cleanName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/** Presets guardados: nombre -> ajustes, descartando lo que no tenga forma de preset. */
export function normalizePresets(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, bundle] of Object.entries(raw)) {
    const clean = cleanName(name);
    if (clean && bundle && typeof bundle === "object") out[clean] = normalize(bundle);
  }
  return out;
}

/** Nombre del preset guardado que coincide con estos ajustes, si hay alguno. */
export function matchingPreset(presets, bundle) {
  const now = JSON.stringify(normalize(bundle));
  return Object.keys(presets).find((name) => JSON.stringify(presets[name]) === now) ?? null;
}
