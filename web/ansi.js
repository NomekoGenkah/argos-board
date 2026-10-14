// Utilidades de texto con secuencias ANSI.

/** Elimina secuencias ANSI (CSI, OSC) dejando solo el texto legible. */
export function stripAnsi(str) {
  if (!str) return "";
  return str
    .replace(/\x1b\[(\d*)C/g, (_, n) => " ".repeat(parseInt(n, 10) || 1))
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "");
}
