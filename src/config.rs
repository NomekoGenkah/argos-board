//! Directorio de configuración y token de ingesta.

use anyhow::{Context, Result};
use std::path::PathBuf;

pub const DEFAULT_PORT: u16 = 8787;

/// `~/.config/argos-board/` (o `$ARGOS_BOARD_CONFIG_DIR`, usado en tests).
pub fn config_dir() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("ARGOS_BOARD_CONFIG_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let dirs = directories::ProjectDirs::from("", "", "argos-board")
        .context("no se pudo determinar el directorio de configuración")?;
    Ok(dirs.config_dir().to_path_buf())
}

fn token_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("token"))
}

/// Genera un token nuevo y lo guarda con permisos 0600. Lo llama `serve` al iniciar.
pub fn create_token() -> Result<String> {
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir).with_context(|| format!("creando {}", dir.display()))?;
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let path = token_path()?;
    write_private(&path, &token).with_context(|| format!("escribiendo {}", path.display()))?;
    Ok(token)
}

/// Lee el token actual (lo usa el wrapper en cada intento de conexión).
pub fn read_token() -> Option<String> {
    let s = std::fs::read_to_string(token_path().ok()?).ok()?;
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

#[cfg(unix)]
fn write_private(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    // Por si el archivo ya existía con otros permisos.
    f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    f.write_all(contents.as_bytes())
}

#[cfg(not(unix))]
fn write_private(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    std::fs::write(path, contents)
}
