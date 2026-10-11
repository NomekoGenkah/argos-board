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

/// Tamaño de la terminal local, o 24x80 si no hay terminal.
pub fn size() -> (u16, u16) {
    match crossterm::terminal::size() {
        Ok((cols, rows)) if cols > 0 && rows > 0 => (rows, cols),
        _ => (24, 80),
    }
}
