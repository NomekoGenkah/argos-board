// Pixel-art de la Oficina. Cada sprite es texto: una letra = un color de la
// paleta ("." = transparente). Las letras de "rol" (M = color principal de la
// mascota, m = su sombra…) se resuelven por agente.

const art = (s) => {
  const rows = s.trim().split("\n").map((r) => r.trim());
  return { w: rows[0].length, h: rows.length, rows };
};

export const OUTLINE = "#2b1f1d";

// --- Mascotas ----------------------------------------------------------------
// Una familia de bichitos de bloque: misma idea, forma propia para cada agente.
// Los ojos, los brazos y las patas se dibujan aparte para poder animarlos.

// Claude: el bicho naranja de bloque, con cuatro patitas.
const CLAUDE_BODY = art(`
.oooooooooooooo.
oMMMMMMMMMMMMMMo
oMhhMMMMMMMMMMMo
oMhMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
ommmmmmmmmmmmmmo
.oooooooooooooo.
`);

// Antigravity: un domo que flota, sin patas, con antena.
const AGY_BODY = art(`
...L............
...o..oooooo....
...ooMMMMMMMMo..
..oMhhMMMMMMMMo.
.oMhMMMMMMMMMMMo
.oMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
ommmmmmmmmmmmmmo
omomomomomomomo.
.o.o.o.o.o.o.o..
`);

// OpenCode: un robot cuadrado con la cara como pantalla de terminal.
const OPENCODE_BODY = art(`
oooooooooooooooo
oMMMMMMMMMMMMMMo
oMooooooooooooMo
oMoDDDDDDDDDDoMo
oMoDDDDDDDDDDoMo
oMoDDDDDDDDDDoMo
oMoDDDDDDDDDDoMo
oMooooooooooooMo
oMMMMMMMMMMMMMMo
ommmmmmmmmmmmmmo
oooooooooooooooo
`);

// Cualquier otro comando: un cubito marrón.
const GENERIC_BODY = art(`
..oooooooooooo..
.oMMMMMMMMMMMMo.
oMhMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
oMMMMMMMMMMMMMMo
.ommmmmmmmmmmmo.
..oooooooooooo..
`);

/**
 * Cada mascota: cuerpo, dónde van los ojos (esquina superior de cada uno),
 * a qué altura salen los brazos, dónde van las patas y sus colores.
 */
export const MASCOTS = {
  claude: {
    body: CLAUDE_BODY,
    eyes: [
      [4, 3],
      [11, 3],
    ],
    eyeH: 3,
    eyeColor: OUTLINE,
    armY: 5,
    legs: [2, 5, 10, 13],
    colors: { M: "#d97757", m: "#b35a3d", h: "#eda383" },
  },
  agy: {
    body: AGY_BODY,
    eyes: [
      [5, 5],
      [10, 5],
    ],
    eyeH: 2,
    eyeColor: OUTLINE,
    armY: 6,
    legs: [],
    floats: true,
    colors: { M: "#3d7fe0", m: "#2a5cab", h: "#8db8f5", L: "#9fe3ff" },
  },
  opencode: {
    body: OPENCODE_BODY,
    eyes: [
      [5, 4],
      [10, 4],
    ],
    eyeH: 2,
    eyeColor: "#6dffa8",
    screen: true,
    armY: 5,
    legs: [3, 12],
    colors: { M: "#f4f1f0", m: "#c9c0bd", D: "#23242c" },
  },
  generic: {
    body: GENERIC_BODY,
    eyes: [
      [5, 3],
      [10, 3],
    ],
    eyeH: 2,
    eyeColor: OUTLINE,
    armY: 4,
    legs: [4, 11],
    colors: { M: "#9a7668", m: "#755a4f", h: "#c4a395" },
  },
};

// Brazos: a los lados, levantado (sostiene un cartel) o hacia abajo (teclea).
export const ARM = art(`
ooo
oMM
ooo
`);
export const ARM_UP = art(`
.oo
oMo
oMo
oMo
oo.
`);
export const ARM_DOWN = art(`
ooo
oMo
oMo
oo.
`);
export const LEG = art(`
oMo
oMo
ooo
`);

// --- Cosas que sostienen -----------------------------------------------------
export const SIGN_Q = art(`
ooooooooo
oWWWRRWWo
oWWRWWRWo
oWWWWRWWo
oWWWRWWWo
oWWWWWWWo
oWWWRWWWo
ooooooooo
`);
export const PAPER = art(`
ooooooo
oWWWWWo
oWLLLWo
oWWWWWo
oWLLWWo
oWWWWWo
oWRRRWo
ooooooo
`);
export const BRIEFCASE = art(`
..oo..
.o..o.
oooooo
oBBBBo
oBYBBo
oooooo
`);
export const MUG = art(`
oooo.
oMMoo
oMMoo
oooo.
`);

// --- Muebles -----------------------------------------------------------------
export const CHAIR = art(`
.oooooooooooo.
oCCCCCCCCCCCCo
oCwwCCCCCCCCCo
oCwCCCCCCCCCCo
oCCCCCCCCCCCCo
oCCCCCCCCCCCCo
occcccccccccco
.oooooooooooo.
`);
export const STOOL = art(`
.oooooooooooo.
oWWWWWWWWWWWWo
oWWWWWWWWWWWWo
.oooooooooooo.
.....o..o.....
....oo..oo....
`);
export const COFFEE_MACHINE = art(`
oooooooooo
oKKKKKKKKo
oKRKKKKGKo
oKKKKKKKKo
ooooooooKo
.oSSSSo.Ko
.oSooSo.Ko
.oSSSSo.Ko
ooooooooKo
oKKKKKKKKo
oooooooooo
`);
export const FRIDGE = art(`
oooooooooooo
oWWWWWWWWWWo
oWWWWWWWWoWo
oWWWWWWWWoWo
oWWWWWWWWWWo
oooooooooooo
oWWWWWWWWWWo
oWWWWWWWWoWo
oWWWWWWWWoWo
oWWWWWWWWoWo
oWWWWWWWWWWo
oWWWWWWWWWWo
oWWWWWWWWWWo
oooooooooooo
`);
export const DOOR = art(`
oooooooooooooooo
oFFFFFFFFFFFFFFo
oFooooooooooooFo
oFoDDDDDDDDDDoFo
oFoDddddddddDoFo
oFoDdDDDDDDdDoFo
oFoDdDDDDDDdDoFo
oFoDddddddddDoFo
oFoDDDDDDDDDDoFo
oFoDDDDDDDDDYoFo
oFoDDDDDDDDDYoFo
oFoDDDDDDDDDDoFo
oFoDddddddddDoFo
oFoDdDDDDDDdDoFo
oFoDdDDDDDDdDoFo
oFoDddddddddDoFo
oFoDDDDDDDDDDoFo
oFoDDDDDDDDDDoFo
oFoDDDDDDDDDDoFo
oooooooooooooooo
`);
export const COAT_RACK = art(`
.o.o.o.
ooooooo
...o...
...o...
...o...
...o...
...o...
...o...
...o...
...o...
..ooo..
.ooooo.
`);

// --- Globos de diálogo -------------------------------------------------------
export const BUBBLE = art(`
.oooooooooo.
oBBBBBBBBBBo
oBBBBBBBBBBo
oBBBBBBBBBBo
oBBBBBBBBBBo
oBBBBBBBBBBo
oBBBBBBBBBBo
oBBBBBBBBBBo
.oBBoooooooo
.oBo........
.oo.........
`);
export const GLYPHS = {
  hand: art(`
..G.G.
.G.G.G
.G.G.G
GGGGGG
GGGGGG
.GGGGG
..GGG.
`),
  bang: art(`
..GG..
..GG..
..GG..
..GG..
..GG..
......
..GG..
`),
  dots: art(`
......
......
......
......
GG.G.G
GG.G.G
......
`),
};

// --- Objetos del escritorio --------------------------------------------------
export const PROPS = {
  mug: art(`
.oooo..
.oMMoo.
.oMMoMo
.oMMoo.
..oo...
`),
  plant: art(`
.g...g.
gGg.gGg
.gGgGg.
..gGg..
.ooooo.
.oTTTo.
..oTo..
`),
  duck: art(`
..oo...
.oYYo..
oYYEYoo
.oYYYOO
oYYYYYo
.ooooo.
`),
  books: art(`
.oooooo
.oRRRRo
oooooo.
oBBBBo.
.oooooo
.oGGGGo
.oooooo
`),
};

export const STEAM = [
  art(`
.w..
..w.
.w..
`),
  art(`
..w.
.w..
..w.
`),
];

export const BIG_PLANT = art(`
....g.....g...
...gGg...gGg..
.g.gGGg.gGGg.g
gGg.gGGgGGg.gG
.gGg.gGGGg.gGg
..gGGgGGGgGGg.
...gGGGGGGGg..
....gGGGGGg...
.....gGGGg....
..oooooooooo..
..oTTTTTTTTo..
..oTttttttTo..
...oTTTTTTo...
...oTTTTTTo...
....oooooo....
`);

// --- Fuente de 3x5 para carteles ---------------------------------------------
export const FONT = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  0: ["###", "#.#", "#.#", "#.#", "###"],
  1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["###", "..#", "###", "#..", "###"],
  3: ["###", "..#", ".##", "..#", "###"],
  4: ["#.#", "#.#", "###", "..#", "..#"],
  5: ["###", "#..", "###", "..#", "###"],
  6: ["###", "#..", "###", "#.#", "###"],
  7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"],
  9: ["###", "#.#", "###", "..#", "###"],
  " ": ["...", "...", "...", "...", "..."],
};

export const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const glyph = (ch) => FONT[ch] ?? FONT[" "];

/** Ancho en píxeles de un texto en la fuente de 3x5 (con `scale`). */
export function textWidth(text, scale = 1) {
  let w = 0;
  for (const ch of text.toUpperCase()) w += glyph(ch)[0].length + 1;
  return Math.max(0, w - 1) * scale;
}

/** Escribe texto en mayúsculas con la fuente de 3x5. */
export function drawText(ctx, text, x, y, color, scale = 1) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  for (const ch of text.toUpperCase()) {
    const g = glyph(ch);
    g.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === "#") ctx.fillRect(cx + rx * scale, Math.round(y) + ry * scale, scale, scale);
      }
    });
    cx += (g[0].length + 1) * scale;
  }
}

/** Número estable a partir de un texto: el mismo agente se ve igual siempre. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Versión gris de una paleta (agente desconectado). */
export function grayPalette(pal) {
  const out = {};
  for (const [k, hex] of Object.entries(pal)) {
    if (!hex.startsWith("#")) {
      out[k] = hex;
      continue;
    }
    const n = parseInt(hex.slice(1), 16);
    const y = Math.round(((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11);
    const v = Math.round(y * 0.55 + 150 * 0.45);
    out[k] = `rgb(${v} ${v} ${v})`;
  }
  return out;
}

// Los sprites se pintan una vez por paleta en un canvas pequeño y luego se copian.
const cache = new Map();
let paletteIds = new WeakMap();
let nextPaletteId = 0;

function paletteId(pal) {
  let id = paletteIds.get(pal);
  if (id === undefined) {
    id = nextPaletteId++;
    paletteIds.set(pal, id);
  }
  return id;
}

export function clearSpriteCache() {
  cache.clear();
  paletteIds = new WeakMap();
}

function rasterize(sprite, pal, flip) {
  const c = document.createElement("canvas");
  c.width = sprite.w;
  c.height = sprite.h;
  const g = c.getContext("2d");
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x]];
      if (row[x] === "." || !color) continue;
      g.fillStyle = color;
      g.fillRect(flip ? sprite.w - 1 - x : x, y, 1, 1);
    }
  });
  return c;
}

/** Dibuja un sprite en (x, y) con una paleta; `flip` lo refleja en horizontal. */
export function draw(ctx, sprite, x, y, pal, flip = false) {
  let ids = cache.get(sprite);
  if (!ids) cache.set(sprite, (ids = new Map()));
  const key = paletteId(pal) * 2 + (flip ? 1 : 0);
  let img = ids.get(key);
  if (!img) ids.set(key, (img = rasterize(sprite, pal, flip)));
  ctx.drawImage(img, Math.round(x), Math.round(y));
}
