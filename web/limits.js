// Límites de tamaño compartidos entre la consola, el dictado y el servidor.
//
// El servidor rechaza un `Input::Text` de más de `MAX_INPUT_TEXT` bytes UTF-8
// (`src/model.rs`), así que la página mide lo mismo: BYTES, no caracteres ni
// unidades UTF-16 (que es lo que cuenta el `maxlength` de un textarea). Con
// texto no ASCII, un `maxlength` en unidades UTF-16 deja pasar más bytes de los
// que el servidor acepta.

/** Tope de texto por envío, en bytes UTF-8 (igual que `MAX_INPUT_TEXT` del servidor). */
export const MAX_INPUT_BYTES = 128 * 1024;

const encoder = new TextEncoder();

/** Longitud en bytes UTF-8, como la mide el servidor con `str::len`. */
export function byteLength(text) {
  return encoder.encode(String(text)).length;
}

/** Recorta a lo sumo a `max` bytes UTF-8, sin partir un carácter (ni un par suplente). */
export function clipToBytes(text, max = MAX_INPUT_BYTES) {
  const s = String(text);
  if (encoder.encode(s).length <= max) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    // Ancho en bytes del punto de código (igual que `TextEncoder`).
    const cp = ch.codePointAt(0);
    const size = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (used + size > max) break;
    out += ch;
    used += size;
  }
  return out;
}
