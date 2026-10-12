//! Emulación de pantalla (`vt100`) y detección de estado por actividad.

use crate::model::AgentState;
use crate::redact::redact;
use chrono::{DateTime, Utc};
use regex::Regex;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

static ANSI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)").unwrap());
static SGR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[([0-9;]*)m").unwrap());
static CUF_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[(\d*)C").unwrap());

/// Expande secuencias de avance de cursor horizontal CSI <n> C (CUF) a espacios.
/// `vt100::Screen::rows_formatted` emite `\x1b[C` o `\x1b[<n>C` al omitir celdas vacías
/// entre textos con formato por defecto.
pub fn expand_cuf(s: &str) -> String {
    CUF_RE
        .replace_all(s, |caps: &regex::Captures| {
            let count = caps.get(1).map_or(1, |m| {
                if m.as_str().is_empty() {
                    1
                } else {
                    m.as_str().parse::<usize>().unwrap_or(1)
                }
            });
            " ".repeat(count)
        })
        .into_owned()
}

/// Elimina secuencias de escape ANSI de una cadena para comparaciones y cálculos visuales.
/// Preserva los espacios generados por avances de cursor horizontal (CUF).
pub fn strip_ansi(s: &str) -> String {
    let expanded = expand_cuf(s);
    ANSI_RE.replace_all(&expanded, "").into_owned()
}

/// La fila pinta algún fondo (o invierte colores): sus espacios se ven aunque no haya texto.
/// Es lo que dibuja p. ej. la barra de contexto de Claude, hecha solo de celdas con fondo.
pub fn paints_background(line: &str) -> bool {
    SGR_RE.captures_iter(line).any(|caps| {
        let mut params = caps[1].split(';').map(|p| p.parse::<u32>().unwrap_or(0));
        while let Some(code) = params.next() {
            match code {
                7 | 40..=47 | 48 | 100..=107 => return true,
                // Los argumentos de 38;5;n y 38;2;r;g;b no son códigos SGR.
                38 => match params.next() {
                    Some(5) => {
                        params.next();
                    }
                    Some(2) => {
                        params.nth(2);
                    }
                    _ => {}
                },
                _ => {}
            }
        }
        false
    })
}

/// Hay "salida reciente" si el PTY escribió algo en esta ventana.
pub const ACTIVITY_WINDOW: Duration = Duration::from_secs(2);
/// Un estado percibido debe sostenerse este tiempo antes de reportarse.
pub const HYSTERESIS: Duration = Duration::from_millis(500);
/// Tope de líneas enviadas: la pantalla visible completa cabe de sobra; la
/// página muestra las últimas que quepan en cada tarjeta.
pub const MAX_LINES: usize = 200;

/// Máquina de estados con histéresis. Combina la actividad (cambios de texto
/// en pantalla) con el estado que indiquen los patrones del perfil del agente;
/// el patrón tiene prioridad (p. ej. Claude hace parpadear un `●` mientras pide
/// permiso, así que la pantalla nunca parece quieta).
pub struct Activity {
    last_output: Option<Instant>,
    reported: AgentState,
    candidate: Option<(AgentState, Instant)>,
}

impl Activity {
    pub fn new() -> Self {
        Self {
            last_output: None,
            reported: AgentState::Idle,
            candidate: None,
        }
    }

    pub fn output(&mut self, now: Instant) {
        self.last_output = Some(now);
    }

    #[cfg(test)]
    pub fn reported(&self) -> AgentState {
        self.reported
    }

    fn perceived(&self, now: Instant) -> AgentState {
        match self.last_output {
            Some(t) if now.saturating_duration_since(t) < ACTIVITY_WINDOW => AgentState::Working,
            _ => AgentState::Idle,
        }
    }

    /// Devuelve el nuevo estado si cambió (tras la histéresis). `pattern` es el
    /// estado que indica la pantalla según el perfil, si alguno coincide.
    pub fn tick(&mut self, now: Instant, pattern: Option<AgentState>) -> Option<AgentState> {
        let p = pattern.unwrap_or_else(|| self.perceived(now));
        if p == self.reported {
            self.candidate = None;
            return None;
        }
        match self.candidate {
            Some((c, since)) if c == p => {
                if now.saturating_duration_since(since) >= HYSTERESIS {
                    self.reported = p;
                    self.candidate = None;
                    Some(p)
                } else {
                    None
                }
            }
            _ => {
                self.candidate = Some((p, now));
                None
            }
        }
    }
}

impl Default for Activity {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Screen {
    parser: vt100::Parser,
    pub activity: Activity,
    pub last_output_at: Option<DateTime<Utc>>,
    /// Hash del texto visible tras el último cambio real de pantalla.
    content_hash: u64,
    /// Líneas que salieron de la pantalla visible sin haber pasado por el
    /// scrollback del emulador (p. ej. aplicaciones TUI como Claude que
    /// sobreescriben en el lugar con \x1b[H en vez de hacer scroll).
    history: std::collections::VecDeque<String>,
    /// Última captura de líneas visibles limpias, para detectar desplazamiento.
    prev_visible: Vec<String>,
}

fn hash_text(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

impl Screen {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, MAX_LINES),
            activity: Activity::new(),
            last_output_at: None,
            content_hash: hash_text(""),
            history: std::collections::VecDeque::new(),
            prev_visible: Vec::new(),
        }
    }

    /// Procesa salida del PTY. Solo cuenta como actividad si cambia el texto
    /// visible: algunos agentes (p. ej. `agy`) emiten bytes sin parar mientras
    /// esperan (cursor, redibujados idénticos) y nunca parecerían inactivos.
    pub fn process(&mut self, bytes: &[u8], now: Instant) {
        self.parser.process(bytes);
        let h = hash_text(&self.parser.screen().contents());
        if h != self.content_hash {
            self.content_hash = h;
            self.activity.output(now);
            self.last_output_at = Some(Utc::now());
        }
    }

    /// Modos de teclado que pidió el agente, para traducir la entrada desde la web.
    pub fn input_modes(&self) -> super::input::Modes {
        let s = self.parser.screen();
        super::input::Modes {
            application_cursor: s.application_cursor(),
            bracketed_paste: s.bracketed_paste(),
        }
    }

    pub fn set_size(&mut self, rows: u16, cols: u16) {
        self.parser.screen_mut().set_size(rows, cols);
    }

    pub fn size(&self) -> (u16, u16) {
        self.parser.screen().size()
    }

    /// Contenido completo de la pantalla visible (texto plano).
    pub fn contents(&self) -> String {
        self.parser.screen().contents()
    }

    /// Líneas acumuladas (scrollback + pantalla visible), redactadas.
    pub fn last_lines(&mut self) -> Vec<String> {
        let (rows, cols) = self.size();
        let rows_len = usize::from(rows);
        let screen = self.parser.screen_mut();

        // Determina cuántas filas hay en el búfer de scrollback.
        screen.set_scrollback(usize::MAX);
        let mut offset = screen.scrollback();

        let mut lines = Vec::new();
        while offset > 0 {
            screen.set_scrollback(offset);
            let chunk_size = offset.min(rows_len);
            for row in screen.rows_formatted(0, cols).take(chunk_size) {
                let s = String::from_utf8_lossy(&row);
                lines.push(expand_cuf(&s));
            }
            offset -= chunk_size;
        }

        // Filas visibles actuales (offset = 0).
        screen.set_scrollback(0);
        let mut curr_visible = Vec::new();
        for row in screen.rows_formatted(0, cols) {
            let s = String::from_utf8_lossy(&row);
            curr_visible.push(expand_cuf(&s));
        }

        let cleaned_curr = clean_lines(curr_visible.iter().map(String::as_str), MAX_LINES);

        if lines.is_empty() {
            // Sin scrollback nativo de vt100 (p. ej. Claude usando TUI in-place con \x1b[H),
            // detectamos qué líneas salieron por arriba y las conservamos en history.
            update_tui_history(
                &mut self.history,
                &self.prev_visible,
                &cleaned_curr,
                MAX_LINES,
            );
            self.prev_visible = cleaned_curr.clone();

            let mut combined = Vec::with_capacity(self.history.len() + cleaned_curr.len());
            combined.extend(self.history.iter().cloned());
            combined.extend(cleaned_curr);
            clean_lines(combined.iter().map(String::as_str), MAX_LINES)
        } else {
            // Con scrollback nativo de vt100 (p. ej. agy o CLI estándar).
            self.history.clear();
            self.prev_visible = cleaned_curr;
            lines.extend(curr_visible);
            clean_lines(lines.iter().map(String::as_str), MAX_LINES)
        }
    }
}

/// Detecta si líneas salieron por arriba de la pantalla al sobreescribir en el lugar
/// (como hace Claude Code con secuencias \x1b[H) y las añade al historial.
pub fn update_tui_history(
    history: &mut std::collections::VecDeque<String>,
    prev_visible: &[String],
    curr_visible: &[String],
    max_lines: usize,
) {
    if prev_visible.is_empty() || curr_visible.is_empty() || prev_visible == curr_visible {
        return;
    }

    // Si la primera fila visible no cambió, la pantalla no hizo scroll hacia arriba:
    // fue una actualización en el lugar (un toast/chime flotante, spinner, redibujado de cursor, etc.).
    // En una terminal, las líneas solo salen por arriba cuando la primera fila se desplaza.
    if strip_ansi(&prev_visible[0]) == strip_ansi(&curr_visible[0]) {
        return;
    }

    // Buscamos cuántas líneas se desplazaron hacia arriba: curr[0..k] == prev[shift..shift+k].
    let mut best_shift = None;
    let mut best_len = 0;

    for shift in 1..prev_visible.len() {
        let mut k = 0;
        let mut has_non_trivial = false;
        while shift + k < prev_visible.len()
            && k < curr_visible.len()
            && strip_ansi(&prev_visible[shift + k]) == strip_ansi(&curr_visible[k])
        {
            let s = strip_ansi(&prev_visible[shift + k]);
            let trimmed = s.trim();
            if !trimmed.is_empty() && trimmed.len() > 2 {
                has_non_trivial = true;
            }
            k += 1;
        }
        if has_non_trivial && k > best_len {
            best_len = k;
            best_shift = Some(shift);
        }
    }

    if let Some(shift) = best_shift {
        for line in &prev_visible[..shift] {
            history.push_back(line.clone());
        }
        while history.len() > max_lines {
            history.pop_front();
        }
    }
}

/// Sanea y redacta una lista de líneas, eliminando espacios finales,
/// deduplicando líneas en blanco y tomando las últimas `n`.
pub fn clean_lines<'a, I>(raw_lines: I, n: usize) -> Vec<String>
where
    I: IntoIterator<Item = &'a str>,
{
    // Una fila sin texto pero con fondo (una barra de color) no está en blanco.
    let is_blank = |l: &str| strip_ansi(l).trim().is_empty() && !paints_background(l);
    let mut lines: Vec<&str> = Vec::new();
    for l in raw_lines {
        // Los espacios finales con fondo se ven: solo se recortan si no pintan nada.
        let l = if paints_background(l) {
            l
        } else {
            l.trim_end()
        };
        let blank = is_blank(l);
        let prev_blank = lines.last().is_none_or(|p| is_blank(p));
        if blank && prev_blank {
            continue;
        }
        lines.push(if blank { "" } else { l });
    }
    while lines.last().is_some_and(|l| is_blank(l)) {
        lines.pop();
    }
    let start = lines.len().saturating_sub(n);
    lines[start..].iter().map(|l| redact(l)).collect()
}

/// Helper para tests: procesa un texto multilínea plano.
#[cfg(test)]
pub fn last_lines(contents: &str, n: usize) -> Vec<String> {
    clean_lines(contents.lines(), n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_with_hysteresis() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut a = Activity::new();
        assert_eq!(a.tick(t0, None), None);

        a.output(ms(0));
        assert_eq!(a.tick(ms(100), None), None, "aún dentro de la histéresis");
        assert_eq!(a.tick(ms(700), None), Some(AgentState::Working));

        // Sin salida durante > 2 s → idle tras la histéresis.
        assert_eq!(a.tick(ms(2100), None), None);
        assert_eq!(a.tick(ms(2700), None), Some(AgentState::Idle));
    }

    #[test]
    fn short_blips_do_not_flip_state() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut a = Activity::new();
        a.output(ms(0));
        assert_eq!(a.tick(ms(600), None), None, "primer tick: candidato");
        assert_eq!(a.tick(ms(1200), None), Some(AgentState::Working));
        // Pausa breve: idle percibido < 500 ms y vuelve la salida.
        assert_eq!(a.tick(ms(2100), None), None);
        a.output(ms(2300));
        assert_eq!(a.tick(ms(2400), None), None);
        assert_eq!(a.tick(ms(3000), None), None);
        assert_eq!(a.reported(), AgentState::Working);
    }

    #[test]
    fn screen_last_lines_and_redaction() {
        let mut s = Screen::new(5, 40);
        s.process(
            b"uno\r\n\x1b[31mdos\x1b[0m\r\nAPI_KEY=secreto\r\n",
            Instant::now(),
        );
        assert_eq!(
            s.last_lines(),
            vec!["uno", "\x1b[31mdos", "API_KEY=[REDACTED]"]
        );
        assert_eq!(last_lines("a\nb\n\nc\n", 2), vec!["", "c"]);
        assert_eq!(last_lines("\n\na\n\n\n\nb  \n\n\n", 10), vec!["a", "", "b"]);
    }

    #[test]
    fn screen_retains_ansi_colors_and_truecolor() {
        let mut s = Screen::new(5, 50);
        s.process(
            b"\x1b[1;31mrojo bold\x1b[0m\r\n\x1b[38;2;240;138;72mrgb truecolor\x1b[0m\r\n\x1b[4munderline\x1b[0m\r\n",
            Instant::now(),
        );
        let lines = s.last_lines();
        assert_eq!(lines.len(), 3);
        assert!(
            lines[0].contains("\x1b[1m") && lines[0].contains("\x1b[31m")
                || lines[0].contains("\x1b[1;31m")
                || lines[0].contains("rojo bold")
        );
        assert!(lines[1].contains("\x1b[38;2;240;138;72m") && lines[1].contains("rgb truecolor"));
        assert!(lines[2].contains("\x1b[4m") && lines[2].contains("underline"));
    }

    #[test]
    fn redraws_without_text_changes_are_not_activity() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut s = Screen::new(5, 40);
        s.process(b"> esperando\r\n", ms(0));
        assert_eq!(s.activity.tick(ms(600), None), None);
        assert_eq!(s.activity.tick(ms(1200), None), Some(AgentState::Working));
        // Cursor que parpadea y redibujo idéntico de la línea: no es actividad.
        for i in 0..20u64 {
            s.process(
                b"\x1b[?25l\x1b[?25h\x1b[1;1H> esperando",
                ms(1300 + i * 200),
            );
        }
        assert_eq!(s.activity.tick(ms(5300), None), None);
        assert_eq!(s.activity.tick(ms(5900), None), Some(AgentState::Idle));
        // Un cambio real de texto sí lo es.
        s.process(b"\r\nnueva salida", ms(6000));
        assert_eq!(s.activity.tick(ms(6100), None), None);
        assert_eq!(s.activity.tick(ms(6700), None), Some(AgentState::Working));
    }

    #[test]
    fn pattern_wins_over_activity_with_hysteresis() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut a = Activity::new();
        let ask = Some(AgentState::WaitingInput);
        // Hay salida reciente (algo parpadea), pero la pantalla muestra una pregunta.
        a.output(ms(0));
        assert_eq!(a.tick(ms(100), ask), None, "histéresis");
        a.output(ms(400));
        assert_eq!(a.tick(ms(700), ask), Some(AgentState::WaitingInput));
        a.output(ms(900));
        assert_eq!(
            a.tick(ms(1000), ask),
            None,
            "sigue esperando aunque haya actividad"
        );
        // Un parpadeo de menos de 500 ms sin el patrón no cambia el estado.
        assert_eq!(a.tick(ms(1100), None), None);
        assert_eq!(a.tick(ms(1300), ask), None);
        assert_eq!(a.reported(), AgentState::WaitingInput);
        // El usuario responde: desaparece el patrón y hay actividad → working.
        a.output(ms(1500));
        assert_eq!(a.tick(ms(1500), None), None);
        assert_eq!(a.tick(ms(2100), None), Some(AgentState::Working));
    }

    #[test]
    fn screen_handles_overwrites() {
        let mut s = Screen::new(3, 20);
        s.process(b"progress 10%\rprogress 99%", Instant::now());
        assert_eq!(s.last_lines(), vec!["progress 99%"]);
    }

    #[test]
    fn screen_retains_scrollback_lines() {
        // Pantalla con solo 3 filas visibles, pero procesamos 10 líneas.
        let mut s = Screen::new(3, 40);
        s.process(
            b"linea 1\r\nlinea 2\r\nlinea 3\r\nlinea 4\r\nlinea 5\r\nlinea 6\r\nlinea 7\r\nlinea 8\r\n",
            Instant::now(),
        );
        // last_lines debe recuperar tanto las líneas que scrollearon como las visibles.
        let lines = s.last_lines();
        assert_eq!(
            lines,
            vec![
                "linea 1", "linea 2", "linea 3", "linea 4", "linea 5", "linea 6", "linea 7",
                "linea 8"
            ]
        );
    }

    #[test]
    fn screen_retains_tui_overwritten_lines() {
        // Simula una TUI de 3 líneas que sobreescribe con \x1b[H en vez de hacer scroll.
        let mut s = Screen::new(3, 30);
        // Turno 1
        s.process(b"\x1b[Hlinea 1\r\nlinea 2\r\nlinea 3", Instant::now());
        let l1 = s.last_lines();
        assert_eq!(l1, vec!["linea 1", "linea 2", "linea 3"]);

        // Turno 2: se desplaza hacia arriba con \x1b[H
        s.process(b"\x1b[Hlinea 2\r\nlinea 3\r\nlinea 4", Instant::now());
        let l2 = s.last_lines();
        // linea 1 debe conservarse en el historial
        assert_eq!(l2, vec!["linea 1", "linea 2", "linea 3", "linea 4"]);

        // Turno 3: se desplaza otra fila más
        s.process(b"\x1b[Hlinea 3\r\nlinea 4\r\nlinea 5", Instant::now());
        let l3 = s.last_lines();
        assert_eq!(
            l3,
            vec!["linea 1", "linea 2", "linea 3", "linea 4", "linea 5"]
        );
    }

    #[test]
    fn update_tui_history_with_ansi_codes() {
        let mut s = Screen::new(3, 40);
        // Turno 1 con colores ANSI
        s.process(
            b"\x1b[H\x1b[32mlinea 1\x1b[0m\r\n\x1b[33mlinea 2\x1b[0m\r\nlinea 3",
            Instant::now(),
        );
        let l1 = s.last_lines();
        assert_eq!(l1.len(), 3);

        // Turno 2: se desplaza hacia arriba, linea 2 cambia ligeramente de estilo (p. ej. cursor/spinner)
        s.process(
            b"\x1b[H\x1b[1;33mlinea 2\x1b[0m\r\nlinea 3\r\n\x1b[34mlinea 4\x1b[0m",
            Instant::now(),
        );
        let l2 = s.last_lines();
        assert_eq!(l2.len(), 4);
        assert!(l2[0].contains("linea 1"));
        assert!(l2[1].contains("linea 2"));
        assert!(l2[2].contains("linea 3"));
        assert!(l2[3].contains("linea 4"));
    }

    #[test]
    fn background_only_rows_survive() {
        let mut s = Screen::new(5, 40);
        // Como la barra de contexto de Claude: celdas con fondo, sin texto, hasta el borde.
        s.process(
            b"20k of 1M\r\n\x1b[48;5;69m \x1b[48;5;170m \x1b[48;5;237m          \x1b[49m\r\n\x1b[38;5;69m\xe2\x96\xae\x1b[39m Sys\r\n",
            Instant::now(),
        );
        let lines = s.last_lines();
        assert_eq!(lines.len(), 3);
        assert_eq!(
            strip_ansi(&lines[1]).len(),
            12,
            "los espacios con fondo no se recortan"
        );
        assert!(lines[1].contains("48;5;237"));
    }

    #[test]
    fn paints_background_detects_only_backgrounds() {
        assert!(paints_background("\x1b[48;5;69m  "));
        assert!(paints_background("\x1b[41m  "));
        assert!(paints_background("\x1b[7m  "));
        assert!(paints_background("\x1b[1;48;2;1;2;3m  "));
        assert!(!paints_background("\x1b[38;5;47m x"));
        assert!(!paints_background("\x1b[38;2;40;41;42m x"));
        assert!(!paints_background("\x1b[1;31m x\x1b[0m"));
        assert!(!paints_background("   "));
    }

    #[test]
    fn colored_text_only_rows_still_collapse_when_blank() {
        // Sin fondo, una fila de solo secuencias sigue siendo una línea en blanco.
        assert_eq!(
            clean_lines(["a", "\x1b[31m  \x1b[0m", "\x1b[0m", "b"], 10),
            vec!["a", "", "b"]
        );
    }

    #[test]
    fn expand_cuf_preserves_spaces() {
        let input = "\x1b[2CSegún\x1b[Cla\x1b[Cdocumentación\x1b[10Ctest";
        let out = expand_cuf(input);
        assert_eq!(out, "  Según la documentación          test");
        assert_eq!(strip_ansi(input), "  Según la documentación          test");
    }

    #[test]
    fn tui_in_place_toast_does_not_duplicate_history() {
        let mut s = Screen::new(4, 40);
        // Turno 1: líneas estables
        s.process(
            b"\x1b[Hlinea 1\r\nlinea 2\r\nlinea 3\r\nlinea 4",
            Instant::now(),
        );
        let l1 = s.last_lines();
        assert_eq!(l1.len(), 4);

        // Turno 2: aparece un toast en la fila 3 sin que la pantalla haga scroll
        s.process(
            b"\x1b[Hlinea 1\r\nlinea 2\r\nlinea 3 [chime]\r\nlinea 4",
            Instant::now(),
        );
        let l2 = s.last_lines();
        assert_eq!(l2.len(), 4); // No debe crecer con duplicados
        assert_eq!(l2[2], "linea 3 [chime]");

        // Turno 3: el toast desaparece con borrado de fin de línea
        s.process(
            b"\x1b[Hlinea 1\r\nlinea 2\r\nlinea 3\x1b[K\r\nlinea 4",
            Instant::now(),
        );
        let l3 = s.last_lines();
        assert_eq!(l3.len(), 4);
        assert_eq!(l3[2], "linea 3");
    }
}
