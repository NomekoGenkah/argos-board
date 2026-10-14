// Idiomas de la página: `node --test tests/web/*.test.mjs`

import assert from "node:assert/strict";
import { test } from "node:test";
import { lang, resolveLang, serverMessage, translateServer, translator } from "../../web/i18n.js";
import es from "../../web/lang/es.js";
import en, { SERVER_ES_EN } from "../../web/lang/en.js";

test("inglés y español tienen exactamente las mismas claves", () => {
  const onlyEs = Object.keys(es).filter((k) => !(k in en));
  const onlyEn = Object.keys(en).filter((k) => !(k in es));
  assert.deepEqual(onlyEs, [], `faltan en inglés: ${onlyEs.join(", ")}`);
  assert.deepEqual(onlyEn, [], `sobran en inglés: ${onlyEn.join(", ")}`);
});

test("cada texto es del mismo tipo en los dos idiomas (texto o función con los mismos datos) y no está vacío", () => {
  for (const key of Object.keys(es)) {
    assert.equal(typeof en[key], typeof es[key], key);
    if (typeof es[key] === "function") {
      assert.equal(en[key].length, es[key].length, `${key}: distinta cantidad de datos`);
      const args = Array.from({ length: es[key].length }, (_, i) => `dato${i}`);
      assert.ok(String(es[key](...args)).length > 0, key);
      assert.ok(String(en[key](...args)).length > 0, key);
    } else {
      assert.ok(es[key].trim().length > 0, `${key} vacío en español`);
      assert.ok(en[key].trim().length > 0, `${key} vacío en inglés`);
    }
  }
});

test("los textos con etiquetas llevan las mismas en los dos idiomas", () => {
  const tags = (s) => (String(s).match(/<\/?[a-z]+>/g) ?? []).join("");
  for (const key of Object.keys(es)) if (typeof es[key] === "string") assert.equal(tags(en[key]), tags(es[key]), key);
});

test("el idioma sale de la preferencia y, en automático, del navegador", () => {
  assert.equal(resolveLang("en", "es-CL"), "en");
  assert.equal(resolveLang("es", "en-US"), "es");
  assert.equal(resolveLang("auto", "en-GB"), "en");
  assert.equal(resolveLang("auto", "es-MX"), "es");
  assert.equal(resolveLang("auto", "fr-FR"), "es", "sin traducción, el idioma de base");
  assert.equal(resolveLang("auto", undefined), "es");
});

test("el traductor cae al español y, si tampoco está, a la clave", () => {
  const tr = translator({ a: "uno", f: (x) => `x=${x}` }, { a: "base", b: "solo base" });
  assert.equal(tr("a"), "uno");
  assert.equal(tr("b"), "solo base");
  assert.equal(tr("f", 3), "x=3");
  assert.equal(tr("no.existe"), "no.existe");
});

test("los mensajes del servidor se traducen al inglés (los conocidos y los que llevan datos)", () => {
  assert.ok(Object.keys(SERVER_ES_EN).length > 10);
  assert.equal(translateServer("el agente terminó", "en"), "the agent has finished");
  assert.equal(translateServer("código incorrecto (3 intentos restantes)", "en"), "wrong code (3 attempts left)");
  assert.equal(translateServer("`agy` no pudo empezar a dictar: se cayó", "en"), "`agy` could not start dictating: se cayó");
  assert.equal(translateServer("algo que no conocemos", "en"), "algo que no conocemos", "lo desconocido pasa igual");
  assert.equal(translateServer("el agente terminó", "es"), "el agente terminó");
  assert.equal(serverMessage("el agente terminó"), translateServer("el agente terminó", lang()), "usa el idioma de la página");
  assert.equal(translateServer(undefined, "en"), undefined);
});
