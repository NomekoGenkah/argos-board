// Vista de la terminal de un agente: xterm.js dibuja la pantalla celda por celda (rejilla exacta,
// cursor, caracteres de cuadro y bloque propios), solo para mirar; escribir va por la consola.

import { Terminal } from "./vendor/xterm/xterm.mjs";
import { WebglAddon } from "./vendor/xterm/addon-webgl.mjs";
import { stripAnsi } from "./ansi.js";
import { FLOOR_FONT, FLOOR_FONT_PHONE, fullFrame, gridOf, historyKey, LINE_HEIGHT, lastContentRow, pickFont, visibleFrame } from "./termgrid.js";
import { DEFAULT_TERM_THEME, termTheme } from "./termthemes.js";

const FONT_FAMILY = '"JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';
const SCROLLBACK = 1000;
const SR_LINES = 60;
const phone = window.matchMedia("(max-width: 700px)");
const SLACK = 5; // px: menos que el relleno de la caja (.term), así que lo que sobra no se corta

// La fuente se pide una vez: xterm mide la celda al abrirse y con otra letra saldría desalineada.
let fontReady = null;
function whenFontReady() {
  fontReady ??= (document.fonts?.load(`400 14px "JetBrains Mono"`) ?? Promise.resolve()).catch(() => {});
  return fontReady;
}

/**
 * @param host elemento `.term` (la caja); dentro se monta la terminal.
 * @param opts.theme nombre del tema de terminal; opts.mode "fit" (entra completa) o "width" (ancho; alto con scroll).
 */
export function createTermView(host, { theme = DEFAULT_TERM_THEME, mode = "auto" } = {}) {
  host.classList.add("term");
  const screenEl = document.createElement("div");
  screenEl.className = "term-screen";
  const sr = document.createElement("div"); // no <pre>: los diálogos le darían scroll a todo <pre>
  sr.style.whiteSpace = "pre-wrap";
  sr.className = "sr-only";
  host.append(screenEl, sr);

  let term = null;
  let latest = null; // último agente recibido (se escribe en cuanto la terminal esté abierta)
  let source = null; // de dónde salió lo último escrito: evita redibujar lo mismo
  let signature = "";
  let histKey = null;
  let themeName = theme;
  let fitMode = mode;
  let fontOk = false;
  let anchored = true; // ¿sigue el final, o la persona subió a leer?
  let anchorTop = 0;
  let tail = true; // ¿escribe de arriba abajo (no es de pantalla completa)? Solo importa el final

  const resizeObserver = new ResizeObserver(() => {
    if (!term) {
      flush();
      return;
    }
    fit();
  });
  resizeObserver.observe(host);
  whenFontReady().then(() => {
    fontOk = true;
    flush();
  });

  // Las aplicaciones de pantalla completa (OpenCode) pintan su propio fondo: los márgenes
  // alrededor de la terminal toman ese color en vez de verse como una caja dentro de otra.
  let canvasColor = null;
  function paintHost() {
    host.style.setProperty("--term-surface", canvasColor ?? termTheme(themeName).background);
  }
  paintHost();

  function sampleCanvas() {
    const buf = term.buffer.active;
    const cell = buf.getLine(buf.viewportY)?.getCell(0);
    let color = null;
    if (cell?.isBgRGB()) color = `#${(cell.getBgColor() & 0xffffff).toString(16).padStart(6, "0")}`;
    else if (cell?.isBgPalette()) color = termPaletteColor(cell.getBgColor());
    if (color !== canvasColor) {
      canvasColor = color;
      paintHost();
    }
  }

  function termPaletteColor(index) {
    const t = termTheme(themeName);
    const base = [t.black, t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan, t.white, t.brightBlack, t.brightRed, t.brightGreen, t.brightYellow, t.brightBlue, t.brightMagenta, t.brightCyan, t.brightWhite];
    if (index < 16) return base[index];
    if (index < 232) {
      const n = index - 16;
      const c = (v) => (v === 0 ? 0 : 55 + v * 40);
      return `rgb(${c(Math.floor(n / 36))} ${c(Math.floor((n % 36) / 6))} ${c(n % 6)})`;
    }
    const v = 8 + (index - 232) * 10;
    return `rgb(${v} ${v} ${v})`;
  }

  function open(grid) {
    term = new Terminal({
      cols: grid.cols,
      rows: Math.max(1, grid.lines.length),
      scrollback: SCROLLBACK,
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      lineHeight: LINE_HEIGHT,
      theme: termTheme(themeName),
      cursorStyle: "bar",
      cursorInactiveStyle: "bar",
      cursorWidth: 2,
      cursorBlink: false,
      disableStdin: true,
      drawBoldTextInBrightColors: false,
      smoothScrollDuration: 0,
      customGlyphs: true,
    });
    term.open(screenEl);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose()); // vuelve al dibujo normal; los bloques dependen entonces de la letra
      term.loadAddon(gl);
    } catch {
      /* sin WebGL: dibujo normal */
    }
    // Es solo para mirar: no roba el foco ni las teclas, y con la rueda deja pasar la página si no hay historial.
    term.textarea?.setAttribute("tabindex", "-1");
    term.element?.setAttribute("aria-hidden", "true");
    term.attachCustomWheelEventHandler(() => term.buffer.active.baseY > 0);
  }

  function ready() {
    return fontOk && host.clientWidth > 0 && host.clientHeight > 0;
  }

  function flush() {
    if (latest && ready()) draw(latest);
  }

  const atBottom = () => term.buffer.active.viewportY >= term.buffer.active.baseY;

  function draw(agent) {
    const grid = gridOf(agent);
    const next = `${grid.cols}x${grid.lines.length}|${grid.cursor}|${grid.lines.join("\n")}|${historyKey(grid)}`;
    if (term && next === signature) return;
    signature = next;
    tail = !grid.alt;
    const opening = !term;
    if (opening) open(grid);

    const rows = Math.max(1, grid.lines.length);
    const resized = grid.cols !== term.cols || rows !== term.rows;
    if (resized) term.resize(grid.cols, rows);

    const key = historyKey(grid);
    if (resized || key !== histKey) {
      histKey = key;
      const buf = term.buffer.active;
      const follow = atBottom();
      const from = buf.viewportY;
      term.reset();
      term.write(fullFrame(grid), () => {
        if (!follow) term.scrollToLine(Math.min(from, term.buffer.active.baseY));
      });
    } else {
      term.write(visibleFrame(grid));
    }
    if (opening || resized) fit();
    else if (anchored) anchor();
    term.write("", sampleCanvas); // tras procesar lo escrito, ya se puede mirar el fondo de la esquina
    sr.textContent = (agent.last_lines ?? []).slice(-SR_LINES).map(stripAnsi).join("\n");
  }

  /** Lo que mide la caja por dentro, sin su relleno. */
  function inner() {
    const cs = getComputedStyle(host);
    const x = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const y = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { w: host.clientWidth - x, h: host.clientHeight - y };
  }

  // Lo que mide una celda con cada tamaño de letra: se lo pregunta a xterm una vez por tamaño y pantalla.
  const cells = new Map();
  function measure(size) {
    const key = `${window.devicePixelRatio}:${size}`;
    let cell = cells.get(key);
    if (!cell) {
      term.options.fontSize = size;
      const box = screenEl.getBoundingClientRect();
      cell = { cw: box.width / term.cols, ch: box.height / term.rows };
      cells.set(key, cell);
    }
    return cell;
  }

  /** Letra del tamaño justo para que la terminal entre en su caja. */
  function fit() {
    if (!term || !ready()) return;
    const { w, h } = inner();
    const { size, scroll } = pickFont({ cols: term.cols, rows: term.rows, width: w, height: h, mode: fitMode, measure, slack: SLACK, tail, floor: phone.matches ? FLOOR_FONT_PHONE : FLOOR_FONT });
    if (term.options.fontSize !== size) term.options.fontSize = size;
    host.classList.toggle("term--scroll", scroll);
    anchored = true;
    anchor();
  }

  /** Si no entra, se ve hasta la última fila con contenido (donde el agente espera), no el borde de la pantalla. */
  function anchor() {
    if (!term || !host.classList.contains("term--scroll")) return;
    requestAnimationFrame(() => {
      const cs = getComputedStyle(host);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const cell = measure(term.options.fontSize);
      const row = latest ? lastContentRow(gridOf(latest)) : term.rows - 1;
      anchorTop = Math.max(0, Math.round((row + 1) * cell.ch + pad - host.clientHeight));
      host.scrollTop = anchorTop;
    });
  }
  // Subir a leer suelta el ancla; volver al final la recupera.
  host.addEventListener("scroll", () => {
    if (host.classList.contains("term--scroll")) anchored = Math.abs(host.scrollTop - anchorTop) < 6;
  });

  host.addEventListener("keydown", (ev) => {
    if (!term || ev.target !== host) return;
    const act = { PageUp: () => term.scrollPages(-1), PageDown: () => term.scrollPages(1), Home: () => term.scrollToTop(), End: () => term.scrollToBottom() }[ev.key];
    if (act) {
      ev.preventDefault();
      act();
    }
  });

  const api = {
    update(agent) {
      latest = agent;
      if (source === (agent.grid ?? agent.last_lines) && term) return;
      source = agent.grid ?? agent.last_lines;
      if (ready()) draw(agent);
    },
    setTheme(name) {
      themeName = name;
      paintHost();
      if (term) term.options.theme = termTheme(name);
    },
    setMode(next) {
      fitMode = next;
      fit();
    },
    fit,
    state: () => (term ? { fontSize: term.options.fontSize, cols: term.cols, rows: term.rows, mode: fitMode } : null),
    scrollToTop: () => term?.scrollToTop(),
    scrollToBottom: () => term?.scrollToBottom(),
    lineCount() {
      if (!latest) return 0;
      const g = gridOf(latest);
      return g.history.length + g.lines.length;
    },
    dispose() {
      resizeObserver.disconnect();
      term?.dispose();
      term = null;
    },
  };
  host.termView = api; // para depurar y probar desde la consola del navegador
  return api;
}
