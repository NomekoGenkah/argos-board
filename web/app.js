import { createStore } from "./data.js";
import { createDomRenderer } from "./render.js";
import { prefs } from "./prefs.js";

const themeBtn = document.getElementById("theme");
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === "dark" ? "Modo claro" : "Modo oscuro";
  themeBtn.setAttribute("aria-pressed", String(t === "dark"));
}
applyTheme(prefs.theme());
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  prefs.setTheme(next);
  applyTheme(next);
});

const store = createStore();
const render = createDomRenderer({
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  conn: document.getElementById("conn"),
  live: document.getElementById("live"),
  template: document.getElementById("card-tpl"),
  prefs,
});
store.onChange(render);
store.connect();
