import { createStore } from "./data.js";
import { createDomRenderer } from "./render.js";

const store = createStore();
const render = createDomRenderer({
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  conn: document.getElementById("conn"),
  live: document.getElementById("live"),
  template: document.getElementById("card-tpl"),
});
store.onChange(render);
store.connect();
