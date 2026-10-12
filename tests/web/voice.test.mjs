// Pruebas del dictado por voz de la página: `node --test tests/web/*.test.mjs`
// (no requieren navegador: el reconocedor se simula).

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  createDictation,
  languageChoices,
  MAX_CHARS,
  mergeDictation,
  voiceAvailable,
} from "../../web/voice.js";

/** Reconocedor falso que guarda sus instancias para dirigirlas desde la prueba. */
function fakeWindow({ secure = true } = {}) {
  const instances = [];
  class FakeSR {
    constructor() {
      instances.push(this);
      this.started = false;
      this.stopped = false;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
    }
    // Ayudas de la prueba.
    say(...parts) {
      // parts: [texto, esFinal]
      const results = parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
      this.onresult({ results });
    }
    fail(error) {
      this.onerror({ error });
    }
    end() {
      this.onend();
    }
  }
  return { win: { isSecureContext: secure, SpeechRecognition: FakeSR }, instances };
}

function harness(opts) {
  const { win, instances } = fakeWindow(opts);
  const log = { texts: [], states: [], errors: [] };
  const d = createDictation({
    lang: () => "es-CL",
    onText: (t) => log.texts.push(t),
    onState: (s) => log.states.push(s),
    onError: (e) => log.errors.push(e),
    win,
  });
  return { d, log, instances, win };
}

test("mergeDictation une con un solo espacio y respeta el tope", () => {
  assert.equal(mergeDictation("", "hola"), "hola");
  assert.equal(mergeDictation("", " hola"), "hola");
  assert.equal(mergeDictation("ya hay", "hola"), "ya hay hola");
  assert.equal(mergeDictation("ya hay ", " hola"), "ya hay hola");
  assert.equal(mergeDictation("a\n", "b"), "a\nb");
  assert.equal(mergeDictation("", "x".repeat(MAX_CHARS + 50)).length, MAX_CHARS);
});

test("languageChoices pone el del navegador primero, sin repetir ni basura", () => {
  assert.deepEqual(languageChoices("es-CL").slice(0, 2), ["es-CL", "es-ES"]);
  assert.equal(languageChoices("fr-FR")[0], "fr-FR");
  assert.equal(new Set(languageChoices("es-ES")).size, languageChoices("es-ES").length);
  assert.ok(!languageChoices("<script>").includes("<script>"));
  assert.ok(!languageChoices(undefined).includes(undefined));
});

test("voiceAvailable pide reconocedor y contexto seguro", () => {
  assert.equal(voiceAvailable(fakeWindow().win), true);
  assert.equal(voiceAvailable(fakeWindow({ secure: false }).win), false); // HTTP en la red
  assert.equal(voiceAvailable({ isSecureContext: true }), false); // p. ej. Firefox
});

test("dictar escribe lo provisional y lo final a continuación de lo que había", () => {
  const { d, log, instances } = harness();
  d.start("antes");
  assert.deepEqual(log.states, [true]);
  const rec = instances[0];
  assert.equal(rec.lang, "es-CL");
  assert.equal(rec.continuous && rec.interimResults, true);
  rec.say(["hola", false]);
  assert.equal(log.texts.at(-1), "antes hola");
  rec.say(["hola mundo", true], [" cómo", false]);
  assert.equal(log.texts.at(-1), "antes hola mundo cómo");
});

test("stop espera a que la sesión cierre y deja el texto final", async () => {
  const { d, log, instances } = harness();
  d.start("");
  const rec = instances[0];
  rec.say(["hola", false]);
  const done = d.stop();
  assert.equal(rec.stopped, true);
  rec.say(["hola mundo", true]); // el navegador entrega lo último al parar
  rec.end();
  await done;
  assert.equal(log.texts.at(-1), "hola mundo");
  assert.deepEqual(log.states, [true, false]);
  assert.equal(d.listening, false);
});

test("si el navegador corta la sesión, se reinicia y se conserva lo dicho", () => {
  const { d, log, instances } = harness();
  d.start("");
  instances[0].say(["primera frase", true]);
  instances[0].end(); // Chrome cierra las sesiones continuas cada cierto tiempo
  assert.equal(instances.length, 2, "se abrió una sesión nueva");
  assert.equal(instances[1].started, true);
  instances[1].say(["segunda", false]);
  assert.equal(log.texts.at(-1), "primera frase segunda");
  assert.deepEqual(log.states, [true]); // sigue escuchando
});

test("un error fatal para el dictado y avisa; no-speech se ignora", async () => {
  const { d, log, instances } = harness();
  d.start("");
  instances[0].fail("no-speech");
  assert.deepEqual(log.errors, []);
  assert.equal(d.listening, true);
  instances[0].fail("not-allowed");
  assert.match(log.errors[0], /bloqueó el micrófono/);
  assert.equal(d.listening, false);
  instances[0].end();
  assert.equal(instances.length, 1, "no se reinicia tras un error");
  assert.deepEqual(log.states, [true, false]);
});

test("si las sesiones mueren al instante, deja de reiniciar", () => {
  const { d, log, instances } = harness();
  d.start("");
  for (let i = 0; i < 5 && d.listening; i++) instances.at(-1).end();
  assert.equal(d.listening, false);
  assert.match(log.errors.at(-1), /se detiene solo/);
  assert.ok(instances.length <= 4, `abrió ${instances.length} sesiones`);
});

test("stop no se cuelga si el navegador nunca avisa del fin", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { d, log } = harness();
    d.start("");
    const done = d.stop();
    mock.timers.tick(2000);
    await done;
    assert.deepEqual(log.states, [true, false]);
  } finally {
    mock.timers.reset();
  }
});

test("start dos veces no abre dos sesiones", () => {
  const { d, instances } = harness();
  d.start("");
  d.start("");
  assert.equal(instances.length, 1);
});
