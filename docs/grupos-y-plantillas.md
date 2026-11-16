# Grupos y plantillas de agentes — checklist

Plan para poder **agrupar agentes en secciones propias** y **lanzar desde plantillas con instrucciones editables**. Es la versión simple de un «modo orquesta»: el humano sigue siendo el director, no hay jerarquía ni agentes que lancen agentes.

Origen: un amigo pidió «modo orquesta con jerarquía». Se compararon cinco opciones (A+B, C, D, E; ver el análisis del 2026-10-16) y se decidió empezar por lo más barato: agrupar y plantillas. La jerarquía con un agente líder (`ctl`/MCP, opción C) queda **fuera de alcance** (ver el final).

Severidad no aplica: todo es una función nueva. Esfuerzo: **S** (horas) · **M** (~1 día) · **L** (varios días). Las estimaciones son mías y no están medidas.

---

## Cómo retomar entre sesiones

1. Lee este archivo de arriba abajo, sobre todo **Decisiones** y **Estado actual**.
2. Busca el primer ítem sin marcar (`- [ ]`) del hito en curso. Los hitos van en orden; cada uno deja el repo funcionando y se puede commitear solo.
3. Al terminar un ítem: márcalo `- [x]`, añade una línea `✅` con lo que se hizo de verdad y cualquier desvío (igual que en `docs/mejoras-oficina.md`), y actualiza **Estado actual**.
4. Cierre de cada hito, siempre:
   - `cargo fmt --check` y `cargo clippy --all-targets -- -D warnings`
   - `cargo test`
   - `node --test tests/web/*.test.mjs` (el CI de GitHub solo corre lo de Rust)
   - `cargo install --path .` (siempre tras un cambio o merge; ver la memoria `reinstall-after-changes`)
   - un commit por hito, en español, con los ids del plan entre paréntesis, p. ej. `Grupos: agrupar agentes y pestañas (G2.1, G2.2)`.
5. Los PR no llevan pie de atribución de Claude Code; los trailers de commit (`Co-Authored-By`) sí.

### Estado actual

- **Hito en curso:** G0 (decisiones y spike). Nada implementado todavía.
- **Última actualización:** 2026-10-16 · commit base `fbce273`.

---

## Qué ya existe (no hay que construirlo)

- Preferencias por navegador en `web/prefs.js` (`localStorage`): posiciones del lienzo, escritorios de la Oficina, foco, presets de aspecto; todo **por nombre de agente** y con `prune*` para no crecer sin fin.
- Lanzar: `Launcher::launch` (`src/server/launch.rs`) con tipo conocido, carpeta dentro de `launch_roots` y argumentos fijos de `config.toml`. Mensaje `FromBrowser::Launch { rid, kind, dir, name }` (`src/model.rs`); `store.launch(kind, dir, name)` en `web/data.js`; diálogo en `web/launcher.js` y `web/index.html`.
- Tres disposiciones del tablero en `web/render.js`: **lienzo** (GridStack libre), **cuadrícula** y **foco**, con `arrange()`, `tileLayout()` y `sortAgents()`.
- Tope de ritmo de 30 mensajes por segundo por sesión (`INPUT_RATE`): lanzar un grupo seguido cabe.
- Idiomas con prueba de paridad `es`/`en` (`tests/web/i18n.test.mjs`).

## Qué falta

- Ningún concepto de grupo ni de plantilla.
- `Launch` no puede llevar instrucciones para el agente.
- Los nombres de agente **no son únicos** por defecto (`claude@carpeta` se repite si lanzas dos en la misma carpeta). Todo lo guardado por nombre (lienzo, escritorios, y ahora grupos) se mezcla en ese caso. Ya pasa hoy; aquí lo evitamos con nombres explícitos al lanzar desde plantilla.

---

## Decisiones

Marca `[x]` cuando se confirme. Las **recomendadas** son las que asume el resto del plan; si cambian, revisa los hitos afectados.

- [ ] **D1 — ¿Dónde viven los grupos?** *Recomendada:* **en el navegador** (`localStorage`, `argos-groups`), como el lienzo y los escritorios. Cero cambios de servidor ni de protocolo. *Costo:* el celular y el PC no comparten grupos. *Alternativa:* subirlos al servidor (campo `group` en `Hello`/`AgentSnapshot`, persistencia en disco); se haría después sin rehacer la UI.
- [ ] **D2 — ¿Qué es una «sección»?** *Recomendada:* empezar con **barra de grupos** (chips con un contador de «te esperan» por grupo; al elegir uno se filtra el tablero y la Oficina) y **después** hacer secciones apiladas (G3, tras un spike). *Por qué:* un filtro esconde agentes que pueden estar esperándote; el contador del chip lo compensa, pero las secciones visibles son mejores para vigilar. *Alternativa:* ir directo a secciones apiladas (más caro).
- [ ] **D3 — ¿Dónde viven las plantillas?** *Recomendada:* **en el navegador** (`argos-templates`) y se mandan con cada `Launch`. *Costo:* no se comparten entre dispositivos. *Alternativa:* `[templates.*]` en `config.toml` (sobreviven, pero el servidor tendría que escribir ese archivo para editarlas desde la página; hoy solo lo lee).
- [ ] **D4 — ¿Cómo se aplican las «instrucciones»?** *Recomendada:* un único campo **«Instrucciones»** que cada CLI recibe con su flag (ver tabla en G4.2). Solo `claude` tiene un system prompt de verdad; en los demás es el primer mensaje. La UI lo dice así. *Alternativa:* teclear el texto con `send_input` tras arrancar; descartada por frágil (hay que esperar a la pregunta de confianza de carpeta).
- [ ] **D5 — Regla de seguridad.** El README dice que los argumentos de los agentes **nunca** vienen del navegador. Con instrucciones llega un *texto* para un flag fijo, nunca un comando ni un flag. Con tu token ya puedes escribirle lo mismo al agente desde la consola, así que no abre nada nuevo; hay que **reescribir la regla** en el README y poner tope de tamaño. *Recomendada:* aceptar esto con las salvaguardas de G4.1.

---

## Hito G0 — Decisiones y spike (S)

- [ ] **G0.1 — Confirmar D1–D5** con el usuario y marcarlas arriba.
- [ ] **G0.2 — Spike de secciones apiladas** (tiempo máximo: medio día). Probar dos formas de tener secciones sin romper el GridStack único de `render.js`, y anotar el resultado aquí:
  - **(a) Widgets de cabecera:** un ítem de GridStack de ancho completo y alto 1, estático, por grupo; `arrange()` calcula posiciones por grupo. Solo en cuadrícula y foco; en el lienzo libre los grupos se marcan con color.
  - **(b) Un GridStack por sección:** `GridStack.init` por grupo con su cabecera. Más fiel, pero `render.js` está construido sobre un único `grid` en la clausura.
  - Criterio: cuál cambia menos líneas de `render.js` (497 hoy) y no rompe el teclado ni la prueba de axe.
- [ ] **G0.3 — Comprobar con tmux real** que un texto con comillas, saltos de línea y unicode pasa intacto como argumento (`tmux 3.6` aquí). Prueba manual con `tmux -L prueba new-session -d -- sh -c 'printf %s "$1" > /tmp/x' _ "texto…"`. Necesario para G4.

---

## Hito G1 — Modelo de grupos, sin interfaz (S)

Objetivo: la lógica pura, probada, sin DOM (como `office-pure.js`).

- [ ] **G1.1 — `web/groups.js` (puro).** Estado `{ groups: [{id, name, color}], members: { [nombreAgente]: idGrupo } }`. Funciones: `createGroup`, `renameGroup`, `deleteGroup` (sus miembros quedan sin grupo), `assign(name, groupId|null)`, `groupOf(name)`, `partition(agents)` → `[{group, agents}]` más «Sin grupo», `waitingCount(agents)` por grupo, `prune(liveNames)`. Validación: nombre 1–40 caracteres, máximo 12 grupos, color de una paleta cerrada (no CSS libre).
- [ ] **G1.2 — Persistencia en `web/prefs.js`:** `groups()`, `setGroups()` con la clave `argos-groups` y normalización defensiva (si el JSON está corrupto, vuelve a vacío). Sigue la regla del archivo: si `localStorage` falla, la página funciona igual.
- [ ] **G1.3 — Poda.** Llamar a `pruneGroups(liveNames)` junto a `pruneLayouts`/`pruneSeats` en `render.js`, con la **misma cautela**: no podar con el tablero vacío (servidor recién arrancado), o se perderían los grupos de agentes que aún no reconectan.
- [ ] **G1.4 — Pruebas:** `tests/web/groups.test.mjs` (alta, baja, reasignar, partición y orden, contadores, poda, límites, JSON corrupto).

---

## Hito G2 — Asignar y filtrar (M)

Objetivo: se puede crear grupos, meter agentes y ver el tablero por grupo. Sin secciones apiladas todavía.

- [ ] **G2.1 — Barra de grupos** en `web/index.html` bajo la cabecera: chips «Todos · {grupo} · Sin grupo» con el contador de «te esperan» de cada uno (reutilizar `NEEDS_YOU` de `alerts.js`). Filtra tablero y Oficina; la elección se recuerda (`argos-group-filter`). Teclado: flechas entre chips, `aria-pressed`.
- [ ] **G2.2 — Asignar un agente a un grupo:** menú en la cabecera de la tarjeta y en el panel del agente (`dialog.js`). Lista de grupos + «Nuevo grupo…» + «Quitar del grupo». Sin arrastrar: con teclado y celular debe poder hacerse.
- [ ] **G2.3 — Gestionar grupos:** diálogo «Grupos» (crear, renombrar, elegir color, borrar), abierto desde la barra y desde *Ajustes*. Mismo estilo que `launch-dialog`.
- [ ] **G2.4 — Filtro en el tablero:** en `render.js`, el filtro se aplica al conjunto `visible` (igual que `isDismissed`). Los agentes que **te esperan** y quedan fuera del filtro siguen contando en el resumen de la cabecera (`showAttention` mira todos), para que el filtro no esconda lo urgente.
- [ ] **G2.5 — Color de grupo en la tarjeta** (borde o etiqueta pequeña; el color del agente sigue en el borde izquierdo, así que usar una etiqueta con el nombre del grupo, no solo color) y **en la Oficina**: etiqueta en la placa del escritorio. No cambian las zonas de la Oficina, que dicen el *estado*.
- [ ] **G2.6 — Idiomas, accesibilidad y pruebas:** claves nuevas en `lang/es.js` y `lang/en.js` (la prueba de paridad las exige); anuncio al lector de pantalla al asignar; revisión con axe en claro, oscuro y 360 px, y en los ocho estilos×temas (como indica el README).

---

## Hito G3 — Secciones apiladas (M–L, según el spike)

Objetivo: cada grupo en su propia sección visible a la vez. **Depende de G0.2.**

- [ ] **G3.1 — Implementar la variante elegida en G0.2** para las disposiciones **cuadrícula** y **foco** (en el **lienzo libre** las tarjetas se mueven a mano; allí el grupo se ve solo por etiqueta, G2.5).
- [ ] **G3.2 — Cabecera de sección:** nombre, color, número de agentes, «te esperan» y plegar/desplegar (`argos-group-collapsed`). Una sección plegada sigue mostrando su contador de «te esperan».
- [ ] **G3.3 — Una columna (celular):** las secciones se apilan igual; revisar que el orden del teclado siga la posición visual (lo exige el README).
- [ ] **G3.4 — Pruebas:** la parte pura (posiciones por sección) a `tests/web/` y una prueba de humo del renderizador; axe otra vez.

---

## Hito G4 — Plantillas e instrucciones (M–L)

Objetivo: lanzar un agente con rol e instrucciones desde una plantilla editable.

### Servidor (Rust)

- [ ] **G4.1 — Protocolo.** En `src/model.rs`, `FromBrowser::Launch` gana `instructions: Option<String>` con `#[serde(default)]`. Saneado en una función pura, probada: quitar caracteres de control salvo `\n` y `\t` (como `Input::sanitized`), rechazar más de **8 KB**, tratar vacío como `None`. **Nunca** escribir el contenido en el log: solo su tamaño (como ya se hace con el `Input`).
- [ ] **G4.2 — Aplicarlo en `src/server/launch.rs`.** `fn instruction_args(kind, text) -> Vec<String>`, pura y con pruebas. Los flags se comprobaron con `--help` en esta máquina el 2026-10-16; **volver a comprobarlos** antes de implementar:

  | Tipo | Flag | Qué es |
  |------|------|--------|
  | `claude` | `--append-system-prompt <texto>` | system prompt añadido |
  | `opencode` | `--prompt <texto>` | prompt inicial |
  | `agy` | `--prompt-interactive <texto>` (alias `-i`) | prompt inicial, sigue interactivo |
  | `copilot` | `-i, --interactive <texto>` | prompt inicial interactivo |

  Va **después** de los argumentos fijos de `config.toml`. `--prompt` de `agy` y `-p` de `copilot` son no interactivos: **no usarlos**.
- [ ] **G4.3 — Pruebas Rust:** deserializar `Launch` con y sin `instructions` (los navegadores viejos no lo mandan), saneado, tope de tamaño, y `instruction_args` por tipo. Una prueba de integración en `tests/integration.rs` (`launch_flow`) que lance con instrucciones y compruebe que el agente falso recibió el argumento. `tests/fake_agent.sh` puede imprimir sus argumentos.
- [ ] **G4.4 — Aviso en `ps`.** Las instrucciones quedan en la línea de comandos del proceso y la ve cualquier usuario local. Documentarlo en Seguridad: no poner secretos en las instrucciones.

### Navegador

- [ ] **G4.5 — `web/templates.js` (puro).** Plantilla `{ id, name, kind, instructions, dir?, group?, agentName? }`, normalización, límites (nombre 40, instrucciones 8 KB, máximo 30 plantillas), exportar/importar JSON. Persistencia en `prefs.js` (`argos-templates`).
- [ ] **G4.6 — `store.launch(kind, dir, name, instructions)`** en `web/data.js` (añadir el campo solo si hay texto).
- [ ] **G4.7 — Diálogo «Plantillas»:** lista, crear, duplicar, borrar, editar (nombre, tipo, instrucciones en un `textarea`, carpeta opcional, grupo opcional). Aviso visible de qué significan las instrucciones en cada tipo (D4).
- [ ] **G4.8 — «Nuevo agente» con plantilla:** selector al principio del diálogo que rellena tipo, nombre, instrucciones y carpeta; todo sigue editable antes de lanzar. Si la plantilla trae grupo, al aparecer la tarjeta (`onLaunched` en `app.js`) se asigna al grupo **por nombre**; por eso la plantilla debería llevar nombre explícito, para no chocar con otro agente.
- [ ] **G4.9 — Plantillas de fábrica opcionales** («Desarrollo», «CI/CD», «Documentación») como ejemplos editables, igual que los presets de fábrica.
- [ ] **G4.10 — Pruebas e idiomas:** `tests/web/templates.test.mjs`, claves `es`/`en`, axe en los diálogos nuevos.

---

## Hito G5 — Lanzar un grupo completo (S–M)

Objetivo: «equipo web» = varias plantillas que se lanzan juntas en un grupo.

- [ ] **G5.1 — Plantilla de grupo:** `{ name, group, members: [idPlantilla…] }`.
- [ ] **G5.2 — Lanzamiento secuencial** desde el navegador con `store.launch` uno tras otro (cabe en `INPUT_RATE`, y cada petición tiene su `rid`). Si uno falla, se informa y se sigue o se detiene según lo que se decida; mostrar el avance «2 de 3».
- [ ] **G5.3 — Nombres únicos:** al lanzar el grupo, si un nombre ya existe entre los agentes vivos, añadir sufijo `-2`, `-3` antes de pedir el lanzamiento, para no mezclar posiciones y grupos que se guardan por nombre.
- [ ] **G5.4 — Pruebas:** la parte pura (nombres únicos, orden y plan de lanzamiento).

---

## Hito G6 — Documentación y cierre (S)

- [ ] **G6.1 — README (`README.md` y `README.en.md`):** sección «Grupos» y «Plantillas» en *La página*; corregir la línea 7 («Solo observa: no lanza, detiene ni controla agentes», que ya no es cierta desde que se pueden lanzar agentes).
- [ ] **G6.2 — Seguridad:** reescribir la regla «argumentos nunca desde el navegador» (D5), con el tope de 8 KB, que no se registra el contenido y que las instrucciones se ven en `ps`.
- [ ] **G6.3 — `PRIVACY.md` y `PRIVACY.en.md`:** grupos y plantillas se guardan solo en el navegador; las instrucciones viajan al servidor local y son argumento del proceso del agente; Argos no las escribe a disco.
- [ ] **G6.4 — `docs/argos-board-spec.md`:** si hay cambios de contrato (`Launch.instructions`).
- [ ] **G6.5 — Revisión final:** `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `node --test tests/web/*.test.mjs`, axe, `cargo install --path .`.

---

## Orden y esfuerzo

| Hito | Qué da | Esfuerzo | Depende de |
|------|--------|----------|------------|
| G0 | Decisiones y spike | S | — |
| G1 | Lógica de grupos probada | S | G0.1 |
| G2 | Crear grupos, asignar, filtrar, etiquetas | M | G1 |
| G4 | Plantillas e instrucciones | M–L | G0.3; independiente de G2/G3 |
| G3 | Secciones apiladas | M–L | G2, G0.2 |
| G5 | Lanzar un grupo completo | S–M | G2, G4 |
| G6 | Docs y cierre | S | todos |

**Camino mínimo que ya se siente como orquesta:** G0 → G1 → G2. G4 puede ir antes que G3 si lo que más se quiere son las plantillas; los dos hitos no se tocan entre sí salvo en `app.js`.

## Riesgos y cosas por verificar

- **`render.js` es el punto delicado.** Es una clausura de ~500 líneas sobre un único GridStack; el filtro (G2.4) es poco intrusivo, las secciones (G3) no. Por eso existe el spike G0.2.
- **Un filtro puede esconder lo urgente.** Mitigación: contador de «te esperan» en cada chip y que el resumen de la cabecera cuente todos los agentes.
- **Todo se guarda por nombre de agente.** Dos agentes con el mismo nombre comparten grupo y posición. Es un límite que ya existe.
- **Sin sincronizar entre dispositivos** (D1, D3). Mitigación barata: exportar/importar JSON (G4.5).
- **Un flag de CLI puede cambiar** entre versiones. `instruction_args` está en un solo sitio y probado; si un CLI nuevo no tiene flag, devolver vacío y avisar en la UI en vez de fallar.
- **Instrucciones muy largas o con caracteres raros** por `tmux`: se comprueba en G0.3 antes de escribir el código.

## Fuera de alcance (a propósito)

- Jerarquía, `parent`/`role` en el servidor, y que un agente lance a otros (`argos-board ctl`/MCP). Si algún día se retoma, necesita tokens por agente, cuotas, aprobación humana y persistencia en el servidor; ver el análisis de la opción C.
- Subagentes nativos de Claude Code en el tablero (opción D) y un orquestador con LLM dentro de `serve` (opción E, descartada).
- Un flag `argos-board run --group` para agrupar desde la terminal. Requeriría llevar el grupo al servidor (D1).
