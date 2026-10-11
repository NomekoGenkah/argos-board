// Pixel-art de la Oficina. Cada sprite es texto: una letra = un color de la
// paleta ("." = transparente). Las letras de "rol" (pelo, piel, camisa…) se
// resuelven por agente, así un mismo dibujo sirve para todos.

const art = (s) => {
  const rows = s.trim().split("\n").map((r) => r.trim());
  return { w: rows[0].length, h: rows.length, rows };
};

// --- Personaje de espaldas, sentado y tecleando ------------------------------
export const BACK = art(`
.....oooooo.....
....oHHHHHHo....
...oHHHHHHHHo...
...oHHHHHHHHo...
...oHHHHHHHHo...
...ohHHHHHHho...
...ohhHHHHhho...
....ohhhhhho....
..oooKKKKKKooo..
.oSSSSSSSSSSSSo.
oSSSSSSSSSSSSSSo
oSSSSAASSSSSSSSo
osSSSAASSSSSSSso
osssssssssssssso
`);

// Codo que asoma al teclear (se dibuja a un lado u otro según el frame).
export const ELBOW = art(`
.oo
oSs
oss
.oo
`);

// Recostado con las manos en la nuca: terminó y descansa.
export const LEAN = art(`
.......oooooo.......
......oHHHHHHo......
..ooooHHHHHHHHoooo..
.oSSoKKHHHHHHKKoSSo.
oSSSSoKHHHHHHKoSSSSo
oSSSo.oHHHHHHo.oSSSo
.oSSo.ohhHHhho.oSSo.
..oSSo.ohhhho.oSSo..
...oSSooKKKKooSSo...
...oSSSSSSSSSSSSo...
..oSSSSSSSSSSSSSSo..
..oSSSSAASSSSSSSSo..
..osSSSAASSSSSSSso..
..osssssssssssssso..
`);

// Agarrándose la cabeza: algo salió mal.
export const PANIC = art(`
.....ooo....ooo.....
....oKKKoooKKKo.....
....oSKHHHHHHKSo....
...oSSoHHHHHHoSSo...
...oSoHHHHHHHHoSo...
..oSSoHHHHHHHHoSSo..
..oSo.ohHHHHho.oSo..
.oSSo.ohhhhhho.oSSo.
.oSo...ohhhho...oSo.
.oSSoooKKKKKKoooSSo.
..oSSSSSSSSSSSSSSo..
..oSSSSAASSSSSSSSo..
..osSSSAASSSSSSSso..
..osssssssssssssso..
`);

// --- Personaje de frente (giró la silla porque te necesita) -----------------
export const FRONT = art(`
.....oooooo.....
....oHHHHHHo....
...oHHHHHHHHo...
...oHHHHHHHHo...
...oHHKKKKHHo...
...oHKKKKKKKo...
...oKEKKKKEKo...
...oKKKKKKKKo...
...okKKMMKKko...
....okKKKKko....
..oooSSSSSSooo..
.oSSSSSSSSSSSSo.
oSSSSSSSSSSSSSSo
oKsSSSSSSSSSSsKo
.oPPPPPPPPPPPPo.
.oPPPPPooPPPPPo.
..oPPPo..oPPPo..
..oDDDo..oDDDo..
`);

// Brazo levantado saludando (dos frames: la mano se inclina).
export const WAVE_A = art(`
.oo.
oKKo
oKKo
.oSo
.oSo
.oSo
oSSo
oSo.
`);
export const WAVE_B = art(`
.....
.oo..
oKKo.
.oKSo
..oSo
..oSo
.oSSo
.oSo.
`);
// Tapa la mano derecha del regazo cuando el brazo está levantado.
export const HIDE_HAND = art(`
so
`);

// Sostiene un papel para que lo firmes (pide permiso).
export const PAPER = art(`
.oooooooooo.
.oWWWWWWWWo.
.oWLLLLLLWo.
.oWWWWWWWWo.
.oWLLLLWWWo.
.oWWWWWWWWo.
oKWRRRRWWWKo
.oooooooooo.
`);

// --- Silla -------------------------------------------------------------------
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
// Chaqueta colgada en el respaldo (el agente se fue).
export const JACKET = art(`
...oooooo...
.ooSSKKSSoo.
oSSSSssSSSSo
oSsSSAASSsSo
oSso.oo.osSo
oSSo....oSSo
.oo......oo.
`);
// Respaldo bajo, para que se vea la camisa (el color del agente) por detrás.
export const CHAIR_LOW = art(`
.oooooooooooo.
oCwwCCCCCCCCCo
oCCCCCCCCCCCCo
occcccccccccco
.oooooooooooo.
`);
export const CHAIR_BASE = art(`
......oo......
...oooooooo...
..oc..oo..co..
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
  question: art(`
.GGGG.
GG..GG
....GG
..GGG.
..GG..
......
..GG..
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
  hand: art(`
..G.G.
.G.G.G
.G.G.G
GGGGGG
GGGGGG
.GGGGG
..GGG.
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
export const ZZZ = art(`
GGG
..G
.G.
GGG
`);

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
  lamp: art(`
..ooo..
.oLLLo.
oLLLLLo
...o...
...o...
..ooo..
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

// --- Planta grande para las esquinas ----------------------------------------
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
..oTtttttttTo.
...oTTTTTTo...
...oTTTTTTo...
....oooooo....
`);

// --- Paletas -----------------------------------------------------------------
export const OUTLINE = "#2b1f1d";

export const SKINS = [
  ["#f6d2b6", "#e2ae8c"],
  ["#e6b28a", "#c98f66"],
  ["#bf8259", "#9e6643"],
  ["#82533a", "#67402c"],
];
export const HAIRS = [
  ["#3b2a20", "#271a13"],
  ["#6b4126", "#4e2e1a"],
  ["#d8a14d", "#b07e32"],
  ["#1e1d24", "#121117"],
  ["#a8472b", "#83351f"],
  ["#9a96a3", "#77737f"],
];
export const PANTS = [
  ["#3d4a66", "#2c364c"],
  ["#4b4038", "#362e28"],
  ["#2f5145", "#213a31"],
];

/** Ropa y accesorio por tipo de agente (el color de la tarjeta). */
export const KIND_LOOK = {
  claude: { shirt: "#e07a39", shade: "#b4561f", logo: "#fde3cf" },
  agy: { shirt: "#2f6fd0", shade: "#1f4f9e", logo: "#bcd5fb", floats: true },
  opencode: { shirt: "#f4f1f0", shade: "#cdc5c2", logo: "#3a3a44", headphones: true },
  generic: { shirt: "#8a6a5f", shade: "#6b5047", logo: "#d9c3b9" },
};

/** Número estable a partir de un texto: el mismo agente se ve igual siempre. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Paleta de un personaje: tipo (ropa) + nombre (pelo, piel, pantalón). */
export function characterPalette(kind, name) {
  const look = KIND_LOOK[kind] ?? KIND_LOOK.generic;
  const h = hash(name);
  const [K, k] = SKINS[h % SKINS.length];
  const [H, hh] = HAIRS[(h >>> 3) % HAIRS.length];
  const [P, p] = PANTS[(h >>> 7) % PANTS.length];
  return {
    o: OUTLINE,
    H,
    h: hh,
    K,
    k,
    E: OUTLINE,
    M: "#b5534a",
    S: look.shirt,
    s: look.shade,
    A: look.logo,
    P,
    p,
    D: "#2a2427",
    W: "#fbfaf7",
    L: "#b9b2ad",
    R: "#d93619",
  };
}

/** Versión gris de una paleta (agente desconectado). */
export function grayPalette(pal) {
  const out = {};
  for (const [k, hex] of Object.entries(pal)) {
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
