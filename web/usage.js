// Consumo de cada agente, siempre a la mano: una barra al pie con lo que llevas gastado. Los datos los
// consulta el servidor a los propios CLI; aquí solo se muestran. La parte sin DOM va aparte para probarla.

import { lang, t } from "./i18n.js";
import { KINDS } from "./kinds.js";

const REFRESH_MS = 5 * 60 * 1000;

/** Cómo de gastado está un límite: ok, atención (75 % o más) o alto (90 % o más). */
export function levelOf(pct) {
  return pct >= 90 ? "high" : pct >= 75 ? "warn" : "ok";
}

/** «Gemini Models» -> «Gemini»: la etiqueta sin la palabra que sobra. */
export function shortLabel(label) {
  return label ? label.replace(/\s+models?$/i, "").trim() : "";
}

/** Tiempo que falta, corto: «2 d 3 h», «5 h 10 min», «12 min». */
export function formatRemaining(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return `${min} min`;
}

/** Cuándo se reinicia un límite: «se reinicia en 2 d» si es una fecha ISO; si no, el texto del agente. */
export function resetText(resets, now = Date.now()) {
  if (!resets) return "";
  const when = /^\d{4}-\d\d-\d\dT/.test(resets) ? Date.parse(resets) : NaN;
  if (Number.isNaN(when)) return t("usage.resetsAt", resets);
  return t("usage.resetsIn", formatRemaining(when - now));
}

const METER_NAME = { session: "usage.session", week: "usage.week", five_hour: "usage.fiveHour" };
const FACT_NAME = { cost: "usage.cost", sessions: "usage.sessions" };
const ERROR_NAME = { no_data: "usage.errNoData", timeout: "usage.errTimeout", failed: "usage.errFailed" };

/** Lo que se dibuja: una ficha por agente, con sus límites (con su nivel) y sus datos sueltos. */
export function chipsOf(report, now = Date.now()) {
  return (report?.agents ?? []).map((a) => ({
    kind: a.kind,
    name: KINDS[a.kind] ?? a.kind,
    error: a.error ? t(ERROR_NAME[a.error] ?? "usage.errFailed") : null,
    meters: (a.meters ?? []).map((m) => {
      const pct = Math.round(m.used_pct);
      return {
        id: m.id,
        label: t(METER_NAME[m.id] ?? m.id),
        extra: shortLabel(m.label),
        pct,
        level: levelOf(m.used_pct),
        reset: resetText(m.resets, now),
      };
    }),
    facts: (a.facts ?? []).map((f) => ({ id: f.id, label: t(FACT_NAME[f.id] ?? f.id), value: f.value })),
  }));
}

const REFRESH_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>';

/** La barra de consumo. `root` es el <aside>; se muestra solo si está activada y el servidor tiene algo que decir. */
export function createUsageBar({ root, store }) {
  const chips = root.querySelector(".usage-chips");
  const at = root.querySelector(".usage-at");
  const button = root.querySelector(".usage-refresh");
  button.innerHTML = REFRESH_ICON;
  let enabled = true;
  let available = false;
  let loadedAt = 0;
  let busy = false;
  let timer = null;

  function show() {
    const on = enabled && available;
    root.hidden = !on;
    document.body.dataset.usage = on ? "on" : "off";
  }

  function paint(report) {
    const now = Date.now();
    chips.replaceChildren(
      ...chipsOf(report, now).map((c) => {
        const el = document.createElement("div");
        el.className = "uchip";
        el.setAttribute("role", "listitem");
        el.dataset.kind = c.kind;
        const top = c.meters.reduce((m, x) => Math.max(m, x.pct), 0);
        el.dataset.level = levelOf(top);
        const name = document.createElement("span");
        name.className = "uchip-name";
        name.textContent = c.name;
        el.append(name);
        for (const m of c.meters) {
          const meter = document.createElement("span");
          meter.className = "umeter";
          meter.dataset.level = m.level;
          meter.setAttribute("role", "meter");
          meter.setAttribute("aria-valuemin", "0");
          meter.setAttribute("aria-valuemax", "100");
          meter.setAttribute("aria-valuenow", String(m.pct));
          meter.setAttribute("aria-label", t("usage.aria", c.name, [m.label, m.extra].filter(Boolean).join(" "), m.pct));
          if (m.reset) meter.title = m.reset;
          meter.innerHTML = '<span class="ulabel"></span><span class="ubar" aria-hidden="true"><i></i></span><span class="unum"></span>';
          meter.querySelector(".ulabel").textContent = [m.label, m.extra].filter(Boolean).join(" ");
          meter.querySelector("i").style.setProperty("--pct", `${Math.min(100, m.pct)}%`);
          meter.querySelector(".unum").textContent = `${m.pct}%`;
          el.append(meter);
        }
        for (const f of c.facts) {
          const fact = document.createElement("span");
          fact.className = "ufact";
          fact.innerHTML = '<span class="ulabel"></span><span class="unum"></span>';
          fact.querySelector(".ulabel").textContent = f.label;
          fact.querySelector(".unum").textContent = f.value;
          el.append(fact);
        }
        if (c.error) {
          const err = document.createElement("span");
          err.className = "uerr";
          err.textContent = c.error;
          el.append(err);
        }
        return el;
      }),
    );
    const hour = new Date(report.at).toLocaleTimeString(lang() === "en" ? "en-US" : "es-CL", { hour: "2-digit", minute: "2-digit" });
    at.textContent = t("usage.at", hour);
    at.title = t("usage.updated", hour);
  }

  async function load(force = false) {
    if (!enabled || busy) return;
    busy = true;
    button.classList.add("spinning");
    if (!at.textContent) at.textContent = t("usage.checking");
    try {
      const res = await store.usage(force);
      available = Boolean(res.available);
      if (res.report) {
        paint(res.report);
        loadedAt = Date.now();
      }
    } finally {
      busy = false;
      button.classList.remove("spinning");
      show();
    }
  }

  button.addEventListener("click", () => load(true));
  const tick = () => {
    if (document.visibilityState === "visible" && Date.now() - loadedAt >= REFRESH_MS - 1000) load(false);
  };
  document.addEventListener("visibilitychange", tick);

  return {
    /** Se activa o se desactiva (un ajuste): desactivada no pide nada. */
    setEnabled(on) {
      enabled = on;
      clearInterval(timer);
      timer = on ? setInterval(tick, 60 * 1000) : null;
      if (on && loadedAt === 0 && store.connected()) load(false);
      show();
    },
    /** La capa de datos avisa de cada cambio: al conectarse se pide el consumo. */
    onChange(event) {
      if (event.change?.kind === "conn" && event.conn === "open") loadedAt = 0;
      if (enabled && event.conn === "open" && loadedAt === 0) load(false);
    },
  };
}
