//! Modo raw de la terminal local, restaurado siempre al salir.

use std::io::IsTerminal;
use std::sync::atomic::{AtomicBool, Ordering};

static RAW_ACTIVE: AtomicBool = AtomicBool::new(false);

pub struct RawModeGuard {
    active: bool,
}

impl RawModeGuard {
    /// Activa el modo raw solo si stdin es una terminal (en tests no lo es).
    pub fn enable() -> std::io::Result<Self> {
        if !std::io::stdin().is_terminal() {
            return Ok(Self { active: false });
        }
        crossterm::terminal::enable_raw_mode()?;
        RAW_ACTIVE.store(true, Ordering::SeqCst);
        install_panic_hook();
        Ok(Self { active: true })
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        if self.active {
            restore();
        }
    }
}

/// Restaura la terminal (idempotente).
pub fn restore() {
    if RAW_ACTIVE.swap(false, Ordering::SeqCst) {
        let _ = crossterm::terminal::disable_raw_mode();
    }
}

fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore();
        prev(info);
    }));
}

/// Tamaño de la terminal local. Sin terminal (p. ej. lanzado oculto desde la
/// página), el de `ARGOS_BOARD_SIZE` (`FILASxCOLUMNAS`) o 24x80.
pub fn size() -> (u16, u16) {
    match crossterm::terminal::size() {
        Ok((cols, rows)) if cols > 0 && rows > 0 => (rows, cols),
        _ => std::env::var("ARGOS_BOARD_SIZE")
            .ok()
            .and_then(|s| parse_size(&s))
            .unwrap_or((24, 80)),
    }
}

fn parse_size(s: &str) -> Option<(u16, u16)> {
    let (rows, cols) = s.split_once('x')?;
    let (rows, cols) = (rows.parse().ok()?, cols.parse().ok()?);
    (rows > 0 && cols > 0).then_some((rows, cols))
}

#[cfg(test)]
mod tests {
    #[test]
    fn size_from_env_format() {
        assert_eq!(super::parse_size("48x160"), Some((48, 160)));
        assert_eq!(super::parse_size("0x10"), None);
        assert_eq!(super::parse_size("grande"), None);
    }
}
