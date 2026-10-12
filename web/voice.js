// Dictado por voz para la consola: lo que dices se escribe en la caja de texto
// (tú revisas y envías). Sirve igual para cualquier agente, porque el texto entra
// por la consola de la página.
//
// Motor: el SpeechRecognition del navegador (Chrome, Edge). El audio lo procesa el
// servicio del propio navegador (Google en Chrome, Microsoft en Edge); argos-board no
// lo ve. El navegador solo deja usar el micrófono en un contexto seguro: la página en
// `localhost` o por HTTPS. El motor está aislado en `createDictation` para poder
// cambiarlo (p. ej. por una transcripción en el servidor) sin tocar la consola.

/** Tope de la caja de la consola (su `maxlength`). */
export const MAX_CHARS = 4000;

/** Un arranque que termina antes de esto cuenta como fallo de reinicio. */
const QUICK_END_MS = 400;
const MAX_QUICK_ENDS = 3;
/** Si el navegador no avisa del fin tras `stop()`, se da por terminado pasado este tiempo. */
const STOP_TIMEOUT_MS = 1500;

export function speechRecognitionClass(win = globalThis) {
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

/** ¿Se puede dictar aquí? Hace falta el reconocedor y un contexto seguro (micrófono). */
export function voiceAvailable(win = globalThis) {
  return Boolean(win.isSecureContext && speechRecognitionClass(win));
}

/** Idiomas del dictado: el del navegador primero, luego los habituales. */
export function languageChoices(navLang) {
  const list = [navLang, "es-CL", "es-ES", "es-MX", "en-US"].filter(
    (l) => typeof l === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(l),
  );
  return [...new Set(list)];
}

/** Une dos trozos de texto con un solo espacio entre ellos (si hace falta). */
function join(a, b) {
  if (!a || !b) return a + b;
  return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`;
}

/** Texto de la caja: lo que había antes + lo dictado (recortado al tope). */
export function mergeDictation(base, spoken) {
  return join(base, spoken.trimStart()).slice(0, MAX_CHARS);
}

/** Mensaje para cada error del reconocedor; `null` = se ignora (no es un fallo). */
export const ERROR_TEXT = {
  "not-allowed": "El navegador bloqueó el micrófono: dale permiso a esta página.",
  "service-not-allowed": "El navegador no permite el reconocimiento de voz aquí.",
  "audio-capture": "No se encontró un micrófono.",
  network: "El servicio de voz del navegador no responde (¿sin conexión?).",
  "language-not-supported": "El navegador no soporta ese idioma de dictado.",
  "no-speech": null,
  aborted: null,
};

/**
 * Dictado continuo. `onText(texto)` recibe el texto completo de la caja en cada
 * cambio (con lo provisional incluido); `onState(escuchando)` y `onError(mensaje)`
 * avisan a la interfaz. Chrome corta las sesiones continuas cada cierto tiempo; se
 * reinician solas mientras no se pida parar.
 */
export function createDictation({ lang, onText, onState, onError, win = globalThis }) {
  const SR = speechRecognitionClass(win);
  let rec = null;
  let wanted = false;
  let base = "";
  let committed = ""; // sesiones ya cerradas
  let session = ""; // lo reconocido en la sesión en curso
  let startedAt = 0;
  let quickEnds = 0;
  let waiting = []; // quienes esperan a que termine la sesión (`await stop()`)

  const emit = () => onText(mergeDictation(base, join(committed, session)));

  function begin() {
    rec = new SR();
    rec.lang = lang();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      session = text;
      emit();
    };
    rec.onerror = (ev) => {
      const known = ev.error in ERROR_TEXT;
      const message = known ? ERROR_TEXT[ev.error] : `Error de voz: ${ev.error}`;
      if (message === null) return;
      wanted = false;
      onError(message);
    };
    rec.onend = () => {
      committed = join(committed, session);
      session = "";
      rec = null;
      if (wanted) {
        quickEnds = Date.now() - startedAt < QUICK_END_MS ? quickEnds + 1 : 0;
        if (quickEnds >= MAX_QUICK_ENDS) {
          wanted = false;
          onError("El reconocimiento de voz se detiene solo; revisa el micrófono.");
        } else {
          begin();
          return;
        }
      }
      settle();
    };
    startedAt = Date.now();
    try {
      rec.start();
    } catch (e) {
      rec = null;
      wanted = false;
      onError(`No se pudo iniciar el dictado: ${e.message ?? e}`);
      settle();
    }
  }

  function settle() {
    onState(false);
    for (const done of waiting.splice(0)) done();
  }

  return {
    get listening() {
      return wanted;
    },
    /** Empieza a dictar a continuación de `current` (el texto que ya hay en la caja). */
    start(current = "") {
      if (wanted || !SR) return;
      wanted = true;
      base = current;
      committed = "";
      session = "";
      quickEnds = 0;
      onState(true);
      begin();
    },
    /** Termina: lo ya dicho se finaliza y queda en la caja. Resuelve cuando la sesión cerró. */
    stop() {
      if (!wanted) return Promise.resolve();
      wanted = false;
      return new Promise((resolve) => {
        waiting.push(resolve);
        if (!rec) {
          settle();
          return;
        }
        rec.stop();
        setTimeout(() => waiting.includes(resolve) && settle(), STOP_TIMEOUT_MS);
      });
    },
  };
}
