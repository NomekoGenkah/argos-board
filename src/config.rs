//! Directorio de configuración, tokens y ajustes del usuario.

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
    let token = new_secret();
    let path = token_path()?;
    write_private(&path, &token).with_context(|| format!("escribiendo {}", path.display()))?;
    Ok(token)
}

fn new_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Token de control: autoriza a la página a escribir en los agentes. Va en el
/// enlace que imprime `serve`. Se conserva entre reinicios (para no tener que
/// abrir un enlace nuevo cada vez); se renueva borrando el archivo.
pub fn control_token() -> Result<String> {
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir).with_context(|| format!("creando {}", dir.display()))?;
    let path = dir.join("control-token");
    if let Ok(s) = std::fs::read_to_string(&path) {
        let s = s.trim();
        if s.len() >= 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            // Por si se copió con otros permisos.
            write_private(&path, s).with_context(|| format!("escribiendo {}", path.display()))?;
            return Ok(s.to_string());
        }
    }
    let token = new_secret();
    write_private(&path, &token).with_context(|| format!("escribiendo {}", path.display()))?;
    Ok(token)
}

/// `allow_input` de `config.toml` (por defecto `true`). Un valor inválido
/// avisa y deja el valor por defecto.
pub fn allow_input(user_toml: Option<&str>) -> (bool, Option<String>) {
    let Some(text) = user_toml else {
        return (true, None);
    };
    let Ok(table) = text.parse::<toml::Table>() else {
        return (true, None); // el aviso de TOML inválido ya lo da el perfil
    };
    match table.get("allow_input") {
        None => (true, None),
        Some(toml::Value::Boolean(b)) => (*b, None),
        Some(_) => (
            true,
            Some("allow_input en config.toml debe ser true o false; se usa true".into()),
        ),
    }
}

/// Lee `config.toml` del directorio de configuración, si existe.
pub fn user_config() -> Option<String> {
    std::fs::read_to_string(config_dir().ok()?.join("config.toml")).ok()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_input_setting() {
        assert_eq!(allow_input(None), (true, None));
        assert_eq!(allow_input(Some("[profiles.claude]\n")), (true, None));
        assert_eq!(allow_input(Some("allow_input = false\n")), (false, None));
        let (v, warn) = allow_input(Some("allow_input = \"no\"\n"));
        assert!(v && warn.is_some());
    }
}
