//! Entrada desde la web: traduce texto y teclas a los bytes que mandaría una
//! terminal, según los modos que el agente activó en su pantalla.

use crate::model::{Input, Key};
use std::time::Duration;

/// Pausa entre el texto y el Enter de "enviar". Si llegan juntos, algunas
/// TUIs los toman como un pegado y el Enter queda como salto de línea.
pub const SUBMIT_DELAY: Duration = Duration::from_millis(120);

/// Modos de la terminal que cambian los bytes de una tecla o un pegado.
#[derive(Debug, Clone, Copy, Default)]
pub struct Modes {
    /// DECCKM: las flechas van como `ESC O A` en vez de `ESC [ A`.
    pub application_cursor: bool,
    /// El agente pidió pegado entre corchetes (`ESC [ 200 ~ … ESC [ 201 ~`).
    pub bracketed_paste: bool,
}

pub fn key_bytes(key: Key, modes: Modes) -> &'static [u8] {
    let app = modes.application_cursor;
    match key {
        Key::Enter => b"\r",
        Key::Esc => b"\x1b",
        Key::Tab => b"\t",
        Key::ShiftTab => b"\x1b[Z",
        Key::Backspace => b"\x7f",
        Key::CtrlC => b"\x03",
        Key::CtrlD => b"\x04",
        Key::Up if app => b"\x1bOA",
        Key::Down if app => b"\x1bOB",
        Key::Right if app => b"\x1bOC",
        Key::Left if app => b"\x1bOD",
        Key::Up => b"\x1b[A",
        Key::Down => b"\x1b[B",
        Key::Right => b"\x1b[C",
        Key::Left => b"\x1b[D",
    }
}

/// Texto tal cual; si tiene varias líneas y el agente acepta pegado entre
/// corchetes, va como pegado (así cada salto de línea no envía el mensaje).
pub fn text_bytes(text: &str, modes: Modes) -> Vec<u8> {
    if text.contains('\n') && modes.bracketed_paste {
        let mut out = b"\x1b[200~".to_vec();
        out.extend_from_slice(text.as_bytes());
        out.extend_from_slice(b"\x1b[201~");
        out
    } else {
        text.as_bytes().to_vec()
    }
}

/// Lo que hay que escribir en el PTY, en tramos: entre un tramo y el
/// siguiente se espera `SUBMIT_DELAY`.
pub fn chunks(input: &Input, modes: Modes) -> Vec<Vec<u8>> {
    match input {
        Input::Key { key } => vec![key_bytes(*key, modes).to_vec()],
        Input::Text { text, submit } => {
            let mut out = Vec::new();
            if !text.is_empty() {
                out.push(text_bytes(text, modes));
            }
            if *submit {
                out.push(b"\r".to_vec());
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_follow_cursor_mode() {
        let normal = Modes::default();
        let app = Modes {
            application_cursor: true,
            ..Modes::default()
        };
        assert_eq!(key_bytes(Key::Up, normal), b"\x1b[A");
        assert_eq!(key_bytes(Key::Up, app), b"\x1bOA");
        assert_eq!(key_bytes(Key::Enter, app), b"\r");
        assert_eq!(key_bytes(Key::CtrlC, normal), b"\x03");
        assert_eq!(key_bytes(Key::ShiftTab, normal), b"\x1b[Z");
    }

    #[test]
    fn text_and_submit_go_in_separate_chunks() {
        let m = Modes::default();
        let send = Input::Text {
            text: "hola".into(),
            submit: true,
        };
        assert_eq!(chunks(&send, m), vec![b"hola".to_vec(), b"\r".to_vec()]);
        let only_enter = Input::Text {
            text: String::new(),
            submit: true,
        };
        assert_eq!(chunks(&only_enter, m), vec![b"\r".to_vec()]);
    }

    #[test]
    fn multiline_uses_bracketed_paste_when_enabled() {
        let paste = Modes {
            bracketed_paste: true,
            ..Modes::default()
        };
        assert_eq!(text_bytes("a\nb", paste), b"\x1b[200~a\nb\x1b[201~");
        assert_eq!(text_bytes("a\nb", Modes::default()), b"a\nb");
        assert_eq!(text_bytes("una línea", paste), "una línea".as_bytes());
    }
}
