// Captura del micrófono: entrega PCM de 16 kHz, 16 bits, mono en tramas de 20 ms
// (ArrayBuffer de 640 bytes). Funciona en Firefox y Chrome; el navegador solo da acceso
// al micrófono con la página en `localhost` o por HTTPS.

import { t } from "./i18n.js";

/** Mensaje comprensible para un error de `getUserMedia`. */
export function micErrorText(e) {
  switch (e?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return t("voice.notAllowed");
    case "NotFoundError":
    case "OverconstrainedError":
      return t("voice.noMic");
    case "NotReadableError":
      return t("voice.micBusy");
    default:
      return t("voice.micFailed", e?.message ?? e);
  }
}

/** Abre el micrófono. Devuelve `{ stop() }`; rechaza con un error de `getUserMedia`. */
export async function openMic({ onFrame }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error(t("voice.noMicHere")), { name: "NotFoundError" });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let ctx = null;
  try {
    ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule("mic-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm16k", { channelCount: 1 });
    node.port.onmessage = (ev) => onFrame(ev.data);
    // El nodo debe estar conectado al destino para procesar; sin volumen no suena nada.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
    return {
      stop() {
        node.port.onmessage = null;
        for (const track of stream.getTracks()) track.stop();
        ctx.close().catch(() => {});
      },
    };
  } catch (e) {
    for (const track of stream.getTracks()) track.stop();
    ctx?.close().catch(() => {});
    throw e;
  }
}
