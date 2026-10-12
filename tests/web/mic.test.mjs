// Pruebas del audio del dictado en servidor: `node --test tests/web/*.test.mjs`
// El procesador del micrófono se carga tal cual está en web/mic-worklet.js, en un contexto
// aislado con lo mínimo de AudioWorklet; el motor de dictado usa un micrófono y un servidor falsos.

import assert from "node:assert/strict";
import fs from "node:fs";
import { mock, test } from "node:test";
import vm from "node:vm";
import { micErrorText } from "../../web/mic.js";
import { createServerDictation } from "../../web/voice.js";

const WORKLET = fs.readFileSync(new URL("../../web/mic-worklet.js", import.meta.url), "utf8");

function loadProcessor(sampleRate) {
  const posted = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage: (buffer) => posted.push(new Int16Array(buffer)) };
    }
  }
  let Processor;
  const context = vm.createContext({
    AudioWorkletProcessor,
    registerProcessor: (_name, cls) => (Processor = cls),
    sampleRate,
    Int16Array,
    Math,
  });
  vm.runInContext(WORKLET, context);
  return { processor: new Processor(), posted };
}

/** Alimenta el procesador con `seconds` de audio de `fn(i)` en bloques de 128 muestras. */
function feed(processor, rate, seconds, fn, channels = 1) {
  const total = Math.round(rate * seconds);
  for (let start = 0; start < total; start += 128) {
    const n = Math.min(128, total - start);
    const block = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: n }, (_, i) => fn(start + i, c)));
    processor.process([block]);
  }
}

const all = (frames) => frames.flatMap((f) => [...f]);

test("el procesador entrega 16 kHz en tramas de 20 ms (640 bytes)", () => {
  for (const rate of [48000, 44100, 16000]) {
    const { processor, posted } = loadProcessor(rate);
    feed(processor, rate, 2, () => 0);
    const samples = all(posted).length;
    assert.ok(Math.abs(samples - 32000) <= 320, `${rate} Hz: ${samples} muestras`);
    assert.ok(posted.every((f) => f.length === 320 && f.byteLength === 640));
  }
});

test("conserva el nivel y la forma de la señal al bajar de 48 kHz a 16 kHz", () => {
  const { processor, posted } = loadProcessor(48000);
  feed(processor, 48000, 1, () => 0.5);
  const out = all(posted);
  assert.ok(out.every((v) => Math.abs(v - 16383) <= 1), "continua 0.5 → ~16383");
  // Un tono de 440 Hz (bien por debajo de Nyquist) mantiene casi toda su amplitud.
  const tone = loadProcessor(48000);
  feed(tone.processor, 48000, 1, (i) => 0.8 * Math.sin((2 * Math.PI * 440 * i) / 48000));
  const peak = Math.max(...all(tone.posted).map(Math.abs)) / 32767;
  assert.ok(peak > 0.75 && peak <= 0.8001, `pico ${peak}`);
});

test("satura sin desbordar y mezcla varios canales", () => {
  const loud = loadProcessor(48000);
  feed(loud.processor, 48000, 0.1, (i) => (i % 2 ? 3 : -3));
  const values = all(loud.posted);
  assert.ok(values.every((v) => v >= -32768 && v <= 32767));
  const stereo = loadProcessor(48000);
  feed(stereo.processor, 48000, 0.1, (_i, c) => (c === 0 ? 1 : -1), 2);
  assert.ok(all(stereo.posted).every((v) => v === 0), "canales opuestos se anulan");
});

test("micErrorText distingue permiso, falta de micrófono y uso ajeno", () => {
  assert.match(micErrorText({ name: "NotAllowedError" }), /bloqueó el micrófono/);
  assert.match(micErrorText({ name: "NotFoundError" }), /No se encontró/);
  assert.match(micErrorText({ name: "NotReadableError" }), /en uso/);
  assert.match(micErrorText(new Error("raro")), /raro/);
});

// ---- Motor de dictado en servidor ----

function harness({ openMicImpl } = {}) {
  const calls = [];
  let listener = null;
  const voice = {
    onEvent: (fn) => {
      listener = fn;
      return () => (listener = null);
    },
    start: () => calls.push("start"),
    stop: () => calls.push("stop"),
    cancel: () => calls.push("cancel"),
    sendAudio: (frame) => calls.push(["audio", frame]),
  };
  const mic = { stopped: false, onFrame: null };
  const log = { texts: [], states: [], phases: [], errors: [] };
  const d = createServerDictation({
    voice,
    micErrorText: (e) => `mic: ${e.name}`,
    openMic:
      openMicImpl ??
      (async ({ onFrame }) => {
        mic.onFrame = onFrame;
        return { stop: () => (mic.stopped = true) };
      }),
    onText: (t) => log.texts.push(t),
    onState: (s) => log.states.push(s),
    onPhase: (p) => log.phases.push(p),
    onError: (e) => log.errors.push(e),
  });
  return { d, calls, log, mic, emit: (msg) => listener?.(msg), hasListener: () => listener !== null };
}

test("dictar abre el micrófono, manda el audio y escribe el texto tras lo que había", async () => {
  const h = harness();
  await h.d.start("antes");
  assert.deepEqual(h.log.states, [true]);
  assert.deepEqual(h.log.phases, ["preparing"]);
  assert.equal(h.calls[0], "start");
  const frame = new ArrayBuffer(640);
  h.mic.onFrame(frame);
  assert.deepEqual(h.calls.at(-1), ["audio", frame]);
  h.emit({ type: "voice_state", state: "recording" });
  assert.equal(h.log.phases.at(-1), "listening");
  h.emit({ type: "voice_text", text: "hola mundo", is_final: false });
  assert.equal(h.log.texts.at(-1), "antes hola mundo");
});

test("stop cierra el micrófono, pide el final y resuelve cuando el servidor queda libre", async () => {
  const h = harness();
  await h.d.start("");
  const done = h.d.stop();
  assert.equal(h.mic.stopped, true);
  assert.equal(h.calls.at(-1), "stop");
  h.emit({ type: "voice_state", state: "finishing" });
  assert.equal(h.log.phases.at(-1), "finishing");
  h.emit({ type: "voice_text", text: "texto final", is_final: true });
  h.emit({ type: "voice_state", state: "idle" });
  await done;
  assert.equal(h.log.texts.at(-1), "texto final");
  assert.deepEqual(h.log.states, [true, false]);
  assert.equal(h.hasListener(), false);
  assert.equal(h.d.listening, false);
});

test("un error del servidor se muestra y termina el dictado una sola vez", async () => {
  const h = harness();
  await h.d.start("");
  h.emit({ type: "voice_error", message: "no se captó voz" });
  h.emit({ type: "voice_state", state: "idle" });
  assert.deepEqual(h.log.errors, ["no se captó voz"]);
  assert.deepEqual(h.log.states, [true, false]);
  assert.equal(h.mic.stopped, true);
});

test("si el micrófono está bloqueado avisa, cancela en el servidor y termina", async () => {
  const h = harness({
    openMicImpl: async () => {
      throw Object.assign(new Error("x"), { name: "NotAllowedError" });
    },
  });
  await h.d.start("");
  assert.deepEqual(h.log.errors, ["mic: NotAllowedError"]);
  assert.ok(h.calls.includes("cancel"));
  assert.deepEqual(h.log.states, [true, false]);
});

test("parar mientras se pide el permiso no deja el micrófono abierto", async () => {
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  const mic = { stopped: false };
  const h = harness({ openMicImpl: () => pending });
  const started = h.d.start("");
  const done = h.d.stop();
  h.emit({ type: "voice_state", state: "idle" });
  await done;
  release({ stop: () => (mic.stopped = true) });
  await started;
  assert.equal(mic.stopped, true, "el micrófono que llegó tarde se cerró");
});

test("si el servidor no avisa del fin, stop no se cuelga", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness();
    await h.d.start("");
    const done = h.d.stop();
    mock.timers.tick(31000);
    await done;
    assert.deepEqual(h.log.states, [true, false]);
  } finally {
    mock.timers.reset();
  }
});
