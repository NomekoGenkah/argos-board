// Emparejar este dispositivo: desde la red, la página no muestra nada hasta que
// se canjea un código de `argos-board pair` por el token del dispositivo.

export function createPairDialog({ dialog, store }) {
  const form = dialog.querySelector("form");
  const input = dialog.querySelector(".pair-input");
  const error = dialog.querySelector(".pair-error");
  const submit = dialog.querySelector('button[type="submit"]');

  // Sin código no hay nada que ver: no se cierra con Esc.
  dialog.addEventListener("cancel", (e) => e.preventDefault());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    submit.disabled = true;
    error.textContent = "";
    const result = await store.pair(code);
    submit.disabled = false;
    if (result.ok) {
      input.value = "";
    } else {
      error.textContent = result.error;
      input.select();
    }
  });

  return {
    render({ auth }) {
      if (auth === "pair" && !dialog.open) {
        dialog.showModal();
        input.focus();
      } else if (auth !== "pair" && dialog.open) {
        dialog.close();
      }
    },
  };
}
