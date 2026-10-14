// Dictado por voz para la consola: lo que dices se escribe en la caja de texto
// (tú revisas y envías). Sirve igual para cualquier agente, porque el texto entra
// por la consola de la página.
//
// Motor: el SpeechRecognition del navegador (Chrome, Edge). El audio lo procesa el
// servicio del propio navegador (Google en Chrome, Microsoft en Edge); argos-board no
// lo ve. El navegador solo deja usar el micrófono en un contexto seguro: la página en
// `localhost` o por HTTPS. El motor está aislado en `createDictation` para poder
// cambiarlo (p. ej. por una transcripción en el servidor) sin tocar la consola.

import { t } from "./i18n.js";

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
  "not-allowed": t("voice.notAllowed"),
  "service-not-allowed": t("voice.serviceNotAllowed"),
  "audio-capture": t("voice.noMic"),
  network: t("voice.network"),
  "language-not-supported": t("voice.langNotSupported"),
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
          onError(t("voice.stops"));
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

/**
 * Dictado transcrito en el servidor (un `agy` que oye el micrófono de ESTA página): sirve en
 * cualquier navegador, también donde no hay SpeechRecognition (Firefox). Misma interfaz que
 * `createDictation`. `voice` es el canal del servidor (`store.voice`) y `openMic` abre el
 * micrófono y entrega tramas de PCM.
 */
export function createServerDictation({ voice, openMic, micErrorText, onText, onState, onPhase = () => {}, onError }) {
  /** Si el servidor no avisa del fin, se da por terminado pasado este tiempo. */
  const FINISH_TIMEOUT_MS = 30000;
  let wanted = false;
  let base = "";
  let mic = null;
  let unsubscribe = null;
  let waiting = [];
  let timer = null;

  function closeMic() {
    mic?.stop();
    mic = null;
  }

  function settle() {
    clearTimeout(timer);
    closeMic();
    unsubscribe?.();
    unsubscribe = null;
    if (!wanted) return;
    wanted = false;
    onState(false);
    for (const done of waiting.splice(0)) done();
  }

  function handle(msg) {
    if (!wanted) return;
    switch (msg.type) {
      case "voice_state":
        if (msg.state === "preparing") onPhase("preparing");
        else if (msg.state === "recording") onPhase("listening");
        else if (msg.state === "finishing") onPhase("finishing");
        else if (msg.state === "idle") settle();
        break;
      case "voice_text":
        onText(mergeDictation(base, msg.text));
        break;
      case "voice_error":
        onError(msg.message);
        settle();
        break;
    }
  }

  return {
    get listening() {
      return wanted;
    },
    /** Empieza a dictar a continuación de `current` (el texto que ya hay en la caja). */
    async start(current = "") {
      if (wanted) return;
      wanted = true;
      base = current;
      onState(true);
      onPhase("preparing");
      unsubscribe = voice.onEvent(handle);
      voice.start();
      try {
        const opened = await openMic({ onFrame: (frame) => voice.sendAudio(frame) });
        if (wanted) mic = opened;
        else opened.stop(); // se paró mientras se pedía el permiso
      } catch (e) {
        onError(micErrorText(e));
        voice.cancel();
        settle();
      }
    },
    /** Termina: el servidor entrega el texto final. Resuelve cuando el dictado cerró. */
    stop() {
      if (!wanted) return Promise.resolve();
      closeMic(); // lo dicho hasta ahora ya salió; el servidor termina de procesarlo
      voice.stop();
      return new Promise((resolve) => {
        waiting.push(resolve);
        timer = setTimeout(settle, FINISH_TIMEOUT_MS);
      });
    },
  };
}
