// Datos compartidos de los agentes (sin DOM): nombre de cada estado, su orden
// y utilidades de duración/ordenación. Así la Oficina y otras vistas no tienen
// que arrastrar la capa de render (term/console/launcher) solo por estos textos.
import { t } from "./i18n.js";

export { KINDS } from "./kinds.js";

export const LABELS = {
  working: t("state.working"),
  waiting_input: t("state.waiting_input"),
  waiting_approval: t("state.waiting_approval"),
  idle: t("state.idle"),
  error: t("state.error"),
  exited: t("state.exited"),
  disconnected: t("state.disconnected"),
};

// Orden de prioridad al listar agentes: primero quien te necesita.
const ORDER = ["waiting_input", "waiting_approval", "error", "working", "idle", "disconnected", "exited"];

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function sortAgents(list) {
  return [...list].sort((a, b) => {
    const d = ORDER.indexOf(a.state) - ORDER.indexOf(b.state);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}
