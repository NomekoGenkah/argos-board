// Idiomas de la página. Español es el de base; inglés lo sigue clave por clave (una prueba lo exige).
// El idioma se decide al cargar y cambiarlo recarga la página: así todo el texto, también el que arman
// los módulos al arrancar, sale en el mismo idioma sin tener que repintar nada.

import es from "./lang/es.js";
import en, { SERVER_ES_EN, SERVER_PATTERNS } from "./lang/en.js";

export const LANGS = { es: "Español", en: "English" };
export const DICTS = { es, en };
const KEY = "argos-lang";

/** Idioma que corresponde a una preferencia ("auto", "es", "en") y al idioma del navegador. */
export function resolveLang(pref, navigatorLang) {
  if (pref === "es" || pref === "en") return pref;
  return /^en\b/i.test(navigatorLang ?? "") ? "en" : "es";
}

/** La preferencia guardada ("auto" si no hay). */
export function storedLangPref() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v === "es" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function saveLangPref(pref) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

const current = resolveLang(storedLangPref(), typeof window === "undefined" ? undefined : navigator.language);

export const lang = () => current;

/** Un traductor para un diccionario: la clave, y si falta, el texto en español, y si no, la clave misma. */
export function translator(dict, base = es) {
  return (key, ...args) => {
    const v = dict[key] ?? base[key] ?? key;
    return typeof v === "function" ? v(...args) : v;
  };
}

/** Texto de la página en el idioma elegido. */
export const t = translator(DICTS[current]);

/** Un mensaje del servidor (en español) en el idioma dado: se traducen los conocidos, el resto pasa igual. */
export function translateServer(text, language) {
  if (language !== "en" || typeof text !== "string") return text;
  if (Object.hasOwn(SERVER_ES_EN, text)) return SERVER_ES_EN[text];
  for (const [re, make] of SERVER_PATTERNS) {
    const m = re.exec(text);
    if (m) return make(...m.slice(1));
  }
  return text;
}

/** Lo mismo, en el idioma de la página. */
export const serverMessage = (text) => translateServer(text, current);

/**
 * Pone el texto en los elementos marcados con `data-i18n` (texto), `data-i18n-html` (con etiquetas propias,
 * como <code>) y `data-i18n-title|aria|placeholder` (atributos).
 */
export function applyDom(root = document) {
  document.documentElement.lang = current;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const [data, attr] of [["i18nTitle", "title"], ["i18nAria", "aria-label"], ["i18nPlaceholder", "placeholder"]]) {
    for (const el of root.querySelectorAll(`[data-i18n-${data.slice(4).toLowerCase()}]`)) el.setAttribute(attr, t(el.dataset[data]));
  }
}

/** Cambia el idioma y recarga. */
export function setLangPref(pref) {
  saveLangPref(pref);
  location.reload();
}
