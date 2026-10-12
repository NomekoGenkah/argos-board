// Conversor de secuencias de escape ANSI a HTML seguro con estilos y colores.

const ANSI_COLORS = {
  0: "var(--ansi-black, #1e1e1e)",
  1: "var(--ansi-red, #d93619)",
  2: "var(--ansi-green, #24644a)",
  3: "var(--ansi-yellow, #b87a04)",
  4: "var(--ansi-blue, #1e56b3)",
  5: "var(--ansi-magenta, #8a38a8)",
  6: "var(--ansi-cyan, #0e7c86)",
  7: "var(--ansi-white, #dcdfe4)",
  8: "var(--ansi-bright-black, #5c6370)",
  9: "var(--ansi-bright-red, #ff6a4d)",
  10: "var(--ansi-bright-green, #1ad988)",
  11: "var(--ansi-bright-yellow, #f7cf88)",
  12: "var(--ansi-bright-blue, #5b93ec)",
  13: "var(--ansi-bright-magenta, #dfb4fc)",
  14: "var(--ansi-bright-cyan, #68c9d6)",
  15: "var(--ansi-bright-white, #ffffff)",
};

// Como fondo, el negro y el gris brillante (el bloque de los mensajes del usuario y de lo
// pegado) usan grises neutros propios: las variables de texto son cafés y, como fondo,
// dejan el texto sin contraste y tiñen la pantalla.
const ANSI_BG_COLORS = {
  ...ANSI_COLORS,
  0: "var(--ansi-bg-black, #2b2b2b)",
  8: "var(--ansi-bg-bright-black, #3a3a3a)",
};

const COLOR_STEPS = [0, 95, 135, 175, 215, 255];

/**
 * Ajusta la luminosidad de un color para garantizar contraste suficiente
 * contra el fondo del terminal del tema actual, preservando su matiz.
 */
export function adjustContrast(r, g, b, isDark) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (isDark) {
    // En modo oscuro (fondo ~#140f0e, lum ~18):
    // Garantiza luminancia mínima de ~110 para textos oscuros o sutiles.
    if (lum < 110) {
      const boost = 110 - lum;
      return [
        Math.min(255, Math.round(r + boost)),
        Math.min(255, Math.round(g + boost)),
        Math.min(255, Math.round(b + boost)),
      ];
    }
  } else {
    // En modo claro (fondo ~#f8f4f2, lum ~245):
    // Garantiza que colores pálidos/claros (como cian claro, gris claro)
    // se oscurezcan proporcionalmente a lum ~105 para no verse desteñidos.
    if (lum > 115) {
      const factor = 105 / lum;
      return [
        Math.min(255, Math.round(r * factor)),
        Math.min(255, Math.round(g * factor)),
        Math.min(255, Math.round(b * factor)),
      ];
    }
  }
  return [r, g, b];
}

/** Devuelve la expresión CSS para un índice de la paleta de 256 colores (`bg`: como fondo). */
export function color256(idx, isDark, bg = false) {
  if (idx >= 0 && idx < 16) return (bg ? ANSI_BG_COLORS : ANSI_COLORS)[idx];
  if (idx >= 16 && idx <= 231) {
    const n = idx - 16;
    let r = COLOR_STEPS[Math.floor(n / 36)];
    let g = COLOR_STEPS[Math.floor((n % 36) / 6)];
    let b = COLOR_STEPS[n % 6];
    if (isDark !== undefined) {
      [r, g, b] = adjustContrast(r, g, b, isDark);
    }
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (idx >= 232 && idx <= 255) {
    const v = (idx - 232) * 10 + 8;
    let [r, g, b] = [v, v, v];
    if (isDark !== undefined) {
      [r, g, b] = adjustContrast(r, g, b, isDark);
    }
    return `rgb(${r}, ${g}, ${b})`;
  }
  return null;
}

/** Escapa caracteres HTML especiales para evitar inyecciones. */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Elimina secuencias ANSI (CSI, OSC) dejando solo el texto legible. */
export function stripAnsi(str) {
  if (!str) return "";
  return str
    .replace(/\x1b\[(\d*)C/g, (_, n) => " ".repeat(parseInt(n, 10) || 1))
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "");
}

/**
 * Convierte un texto con secuencias ANSI a fragmentos HTML con spans estilizados.
 * Soporta colores 16, 256 y RGB TrueColor de 24 bits, así como negrita, cursiva,
 * subrayado, tachado, atenuado e invertido. Adapta la legibilidad de colores RGB
 * al tema activo (claro u oscuro).
 */
export function ansiToHtml(str, isDark = typeof document !== "undefined" && document.documentElement?.dataset.theme === "dark") {
  if (!str) return "";
  if (!str.includes("\x1b")) {
    return escapeHtml(str);
  }
  // Cada fila de la pantalla del terminal es independiente: un fondo o color
  // abierto en una fila no debe pasar a la siguiente.
  // Una fila que es solo fondo (la barra de contexto) es un bloque flex que se
  // estira al ancho visible: no desborda la tarjeta y conserva sus proporciones.
  // Al ser un bloque, no lleva "\n" detrás.
  let html = "";
  const lines = str.split("\n");
  lines.forEach((line, i) => {
    const row = lineToHtml(line, isDark);
    html += row.html;
    if (i < lines.length - 1 && !row.bar) html += "\n";
  });
  return html;
}

function lineToHtml(str, isDark) {
  if (!str.includes("\x1b")) {
    return { html: escapeHtml(str), bar: false };
  }

  const regex = /\x1b\[([0-9;?]*)([a-zA-Z])|\x1b\].*?(?:\x07|\x1b\\)/g;

  let state = {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
  };

  function getStyleString() {
    const styles = [];
    const fg = state.inverse ? (state.bg || "var(--term-bg)") : state.fg;
    const bg = state.inverse ? (state.fg || "var(--term-text)") : state.bg;

    if (fg) styles.push(`color: ${fg}`);
    if (bg) styles.push(`background-color: ${bg}`);
    if (state.bold) styles.push("font-weight: 700");
    if (state.dim) styles.push("opacity: 0.65");
    if (state.italic) styles.push("font-style: italic");

    if (state.underline && state.strikethrough) {
      styles.push("text-decoration: underline line-through");
    } else if (state.underline) {
      styles.push("text-decoration: underline");
    } else if (state.strikethrough) {
      styles.push("text-decoration: line-through");
    }

    return styles.join("; ");
  }

  let html = "";
  let currentOpenStyle = null;
  let lastIndex = 0;
  const runs = []; // { text, styleStr }: para detectar filas que son solo fondo

  function appendChunk(text) {
    if (!text) return;
    const styleStr = getStyleString();
    const last = runs[runs.length - 1];
    if (last && last.styleStr === styleStr) last.text += text;
    else runs.push({ text, styleStr });
    if (currentOpenStyle !== styleStr) {
      if (currentOpenStyle !== null) {
        html += "</span>";
        currentOpenStyle = null;
      }
      if (styleStr.length > 0) {
        // Con fondo: inline-block para que cubra toda la altura de la línea y no deje
        // rendijas entre filas (ver `.lines .bg`).
        const cls = styleStr.includes("background-color") ? ' class="bg"' : "";
        html += `<span${cls} style="${styleStr}">`;
        currentOpenStyle = styleStr;
      }
    }
    html += escapeHtml(text);
  }

  let match;
  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      appendChunk(str.slice(lastIndex, match.index));
    }
    lastIndex = regex.lastIndex;

    const params = match[1];
    const cmd = match[2];

    // CSI <n> C (Cursor Forward): avanza el cursor n columnas (espacios).
    if (cmd === "C") {
      const count = (params && parseInt(params, 10)) || 1;
      appendChunk(" ".repeat(count));
      continue;
    }

    // Ignora secuencias no-SGR (limpieza de cursor/pantalla, etc.)
    if (cmd !== "m") {
      continue;
    }

    const codes = (params && params.length > 0)
      ? params.split(";").map((p) => parseInt(p, 10) || 0)
      : [0];

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        state = {
          fg: null,
          bg: null,
          bold: false,
          dim: false,
          italic: false,
          underline: false,
          strikethrough: false,
          inverse: false,
        };
      } else if (code === 1) {
        state.bold = true;
      } else if (code === 2) {
        state.dim = true;
      } else if (code === 3) {
        state.italic = true;
      } else if (code === 4) {
        state.underline = true;
      } else if (code === 7) {
        state.inverse = true;
      } else if (code === 9) {
        state.strikethrough = true;
      } else if (code === 22) {
        state.bold = false;
        state.dim = false;
      } else if (code === 23) {
        state.italic = false;
      } else if (code === 24) {
        state.underline = false;
      } else if (code === 27) {
        state.inverse = false;
      } else if (code === 29) {
        state.strikethrough = false;
      } else if (code >= 30 && code <= 37) {
        state.fg = ANSI_COLORS[code - 30];
      } else if (code === 39) {
        state.fg = null;
      } else if (code >= 40 && code <= 47) {
        state.bg = ANSI_BG_COLORS[code - 40];
      } else if (code === 49) {
        state.bg = null;
      } else if (code >= 90 && code <= 97) {
        state.fg = ANSI_COLORS[code - 90 + 8];
      } else if (code >= 100 && code <= 107) {
        state.bg = ANSI_BG_COLORS[code - 100 + 8];
      } else if (code === 38 || code === 48) {
        const isFg = code === 38;
        if (i + 1 < codes.length && codes[i + 1] === 5 && i + 2 < codes.length) {
          const color = isFg
            ? color256(codes[i + 2], isDark)
            : color256(codes[i + 2], undefined, true);
          if (isFg) state.fg = color;
          else state.bg = color;
          i += 2;
        } else if (i + 1 < codes.length && codes[i + 1] === 2 && i + 4 < codes.length) {
          let r = Math.max(0, Math.min(255, codes[i + 2]));
          let g = Math.max(0, Math.min(255, codes[i + 3]));
          let b = Math.max(0, Math.min(255, codes[i + 4]));
          if (isFg && isDark !== undefined) {
            [r, g, b] = adjustContrast(r, g, b, isDark);
          }
          const rgb = `rgb(${r}, ${g}, ${b})`;
          if (isFg) state.fg = rgb;
          else state.bg = rgb;
          i += 4;
        }
      }
    }
  }

  if (lastIndex < str.length) {
    appendChunk(str.slice(lastIndex));
  }

  if (currentOpenStyle !== null) {
    html += "</span>";
  }

  const isBar =
    runs.length > 0 &&
    runs.every((r) => r.text.trim() === "") &&
    runs.some((r) => r.styleStr.includes("background-color"));
  if (isBar) {
    const cells = runs
      .map((r) => `<span style="${r.styleStr}; flex: ${r.text.length} 1 0">&nbsp;</span>`)
      .join("");
    return { html: `<span class="bar-row">${cells}</span>`, bar: true };
  }
  return { html, bar: false };
}
