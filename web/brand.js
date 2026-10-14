// La marca: un ojo cuya pupila toma el color de lo que está pasando (te esperan, error, trabajando, calma).
// El mismo ojo es el icono de la pestaña, así que se ve el estado aunque la página esté en segundo plano.

const PUPIL_VAR = {
  wait: "--st-waiting",
  error: "--st-error",
  work: "--st-working-dot",
  calm: "--st-working-dot",
  none: "--st-idle",
};

/** El ojo como SVG suelto (para el icono de la pestaña). */
export function eyeSvg({ lid, pupil }) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<path d="M2 16C7 8 11 6 16 6s9 2 14 10c-5 8-9 10-14 10S7 24 2 16Z" fill="none" stroke="${lid}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<circle cx="16" cy="16" r="5.6" fill="${pupil}"/>` +
    '<circle cx="14" cy="14" r="1.6" fill="#fff" fill-opacity=".85"/></svg>'
  );
}

/** El SVG como dirección que un <link rel="icon"> entiende. */
export const svgHref = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** Qué mira la marca: sin agentes, nada; si no, lo más urgente. */
export function gazeOf(level, agentCount) {
  return agentCount > 0 && PUPIL_VAR[level] ? level : "none";
}

export function createBrand({ root = document.documentElement, mark, icon, themeColor }) {
  let level = "none";

  const color = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  function refresh() {
    if (icon) icon.href = svgHref(eyeSvg({ lid: color("--brand") || "#f2b84b", pupil: color(PUPIL_VAR[level]) || "#35d08e" }));
    if (themeColor) themeColor.content = color("--bg") || "#0e1318";
  }

  return {
    /** La marca mira a `next` (wait | error | work | calm | none). Al empezar a esperar, parpadea una vez. */
    gaze(next) {
      if (next === level) return;
      const woke = next === "wait" && level !== "wait";
      level = next;
      root.dataset.gaze = next;
      if (woke && mark && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        mark.classList.remove("blink");
        void mark.getBoundingClientRect();
        mark.classList.add("blink");
      }
      refresh();
    },
    /** Tras cambiar el estilo o el tema, los colores son otros. */
    refresh,
  };
}
