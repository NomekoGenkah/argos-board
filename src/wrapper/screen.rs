//! Emulación de pantalla (`vt100`) y detección de estado por actividad.

use crate::model::AgentState;
use crate::redact::redact;
use chrono::{DateTime, Utc};
use std::time::{Duration, Instant};

/// Hay "salida reciente" si el PTY escribió algo en esta ventana.
pub const ACTIVITY_WINDOW: Duration = Duration::from_secs(2);
/// Un estado percibido debe sostenerse este tiempo antes de reportarse.
pub const HYSTERESIS: Duration = Duration::from_millis(500);
pub const LAST_LINES: usize = 8;

/// Máquina de estados por actividad de bytes con histéresis.
/// (Los estados por patrón —`waiting_approval`, `error`— llegan en M3.)
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

    /// Devuelve el nuevo estado si cambió (tras la histéresis).
    pub fn tick(&mut self, now: Instant) -> Option<AgentState> {
        let p = self.perceived(now);
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
}

impl Screen {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, 0),
            activity: Activity::new(),
            last_output_at: None,
        }
    }

    pub fn process(&mut self, bytes: &[u8], now: Instant) {
        self.parser.process(bytes);
        self.activity.output(now);
        self.last_output_at = Some(Utc::now());
    }

    pub fn set_size(&mut self, rows: u16, cols: u16) {
        self.parser.screen_mut().set_size(rows, cols);
    }

    pub fn size(&self) -> (u16, u16) {
        self.parser.screen().size()
    }

    /// Contenido completo de la pantalla (texto plano).
    pub fn contents(&self) -> String {
        self.parser.screen().contents()
    }

    /// Últimas líneas no vacías de la pantalla, redactadas.
    pub fn last_lines(&self) -> Vec<String> {
        last_lines(&self.contents(), LAST_LINES)
    }
}

pub fn last_lines(contents: &str, n: usize) -> Vec<String> {
    let lines: Vec<&str> = contents
        .lines()
        .map(str::trim_end)
        .filter(|l| !l.is_empty())
        .collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].iter().map(|l| redact(l)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_with_hysteresis() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut a = Activity::new();
        assert_eq!(a.tick(t0), None);

        a.output(ms(0));
        assert_eq!(a.tick(ms(100)), None, "aún dentro de la histéresis");
        assert_eq!(a.tick(ms(700)), Some(AgentState::Working));

        // Sin salida durante > 2 s → idle tras la histéresis.
        assert_eq!(a.tick(ms(2100)), None);
        assert_eq!(a.tick(ms(2700)), Some(AgentState::Idle));
    }

    #[test]
    fn short_blips_do_not_flip_state() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut a = Activity::new();
        a.output(ms(0));
        assert_eq!(a.tick(ms(600)), None, "primer tick: candidato");
        assert_eq!(a.tick(ms(1200)), Some(AgentState::Working));
        // Pausa breve: idle percibido < 500 ms y vuelve la salida.
        assert_eq!(a.tick(ms(2100)), None);
        a.output(ms(2300));
        assert_eq!(a.tick(ms(2400)), None);
        assert_eq!(a.tick(ms(3000)), None);
        assert_eq!(a.reported(), AgentState::Working);
    }

    #[test]
    fn screen_last_lines_and_redaction() {
        let mut s = Screen::new(5, 40);
        s.process(
            b"uno\r\n\x1b[31mdos\x1b[0m\r\nAPI_KEY=secreto\r\n",
            Instant::now(),
        );
        assert_eq!(s.last_lines(), vec!["uno", "dos", "API_KEY=[REDACTED]"]);
        assert_eq!(last_lines("a\nb\n\nc\n", 2), vec!["b", "c"]);
    }

    #[test]
    fn screen_handles_overwrites() {
        let mut s = Screen::new(3, 20);
        s.process(b"progress 10%\rprogress 99%", Instant::now());
        assert_eq!(s.last_lines(), vec!["progress 99%"]);
    }
}
