//! Lanzar agentes desde la página. Solo tipos conocidos e instalados, solo en
//! carpetas permitidas y con los argumentos de `config.toml` (nunca los del
//! navegador). Si hay tmux, cada agente corre en una sesión de un socket propio
//! de argos-board (así se puede tomar desde una terminal); si no, oculto.

use crate::config::{self, LaunchSettings};
use crate::model::{AgentKind, LaunchInfo, LaunchRef};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Tamaño de la terminal de un agente lanzado (filas x columnas).
const ROWS: u16 = 48;
const COLS: u16 = 160;
/// Tope de subcarpetas que se listan de una vez.
const MAX_DIRS: usize = 500;

pub fn binary(kind: AgentKind) -> Option<&'static str> {
    match kind {
        AgentKind::Claude => Some("claude"),
        AgentKind::Opencode => Some("opencode"),
        AgentKind::Agy => Some("agy"),
        AgentKind::Copilot => Some("copilot"),
        AgentKind::Generic => None,
    }
}

fn kind_key(kind: AgentKind) -> &'static str {
    binary(kind).unwrap_or("generic")
}

/// Busca un ejecutable en el PATH de `serve` (el que heredan los agentes).
fn find_in_path(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(bin))
        .find(|p| is_executable(p))
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

/// Nombre de sesión de tmux: `argos-` y solo letras, números, `-` y `_`.
pub fn session_name(agent_name: &str) -> String {
    let mut s: String = agent_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    s.truncate(40);
    format!("argos-{}", s.trim_matches('-'))
}

/// Una sesión que pudo haber creado argos-board (para no matar otras).
pub fn is_our_session(name: &str) -> bool {
    name.starts_with("argos-")
        && name.len() <= 60
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Nombre que se le da al agente si no se elige uno.
fn default_name(kind: AgentKind, dir: &Path) -> String {
    let folder = dir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".into());
    format!("{}@{folder}", kind_key(kind))
}

fn clean_name(name: &str) -> Result<String, &'static str> {
    let name: String = name.chars().filter(|c| !c.is_control()).collect();
    let name = name.trim();
    if name.chars().count() > 60 {
        return Err("el nombre es demasiado largo (máximo 60 caracteres)");
    }
    Ok(name.to_string())
}

/// Resultado de listar una carpeta.
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub dirs: Vec<String>,
}

pub struct Launcher {
    settings: LaunchSettings,
    /// Raíces ya resueltas (sin `..` ni enlaces), para comparar.
    roots: Vec<PathBuf>,
    port: u16,
    exe: PathBuf,
    /// Socket de tmux de argos-board, si hay tmux.
    tmux: Option<String>,
    /// Procesos ocultos lanzados por este servidor (para poder detenerlos).
    hidden: Arc<Mutex<HashMap<Uuid, Child>>>,
}

impl Launcher {
    pub fn new(port: u16) -> (Self, Vec<String>) {
        let (settings, warnings) = config::launch_settings(config::user_config().as_deref());
        let roots = settings
            .roots
            .iter()
            .filter_map(|r| std::fs::canonicalize(r).ok())
            .collect();
        let tmux_ok = std::env::var_os("ARGOS_BOARD_NO_TMUX").is_none()
            && Command::new("tmux")
                .arg("-V")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
        let socket = if port == config::DEFAULT_PORT {
            "argos-board".to_string()
        } else {
            format!("argos-board-{port}")
        };
        let launcher = Self {
            settings,
            roots,
            port,
            exe: std::env::current_exe().unwrap_or_else(|_| PathBuf::from("argos-board")),
            tmux: tmux_ok.then_some(socket),
            hidden: Arc::default(),
        };
        (launcher, warnings)
    }

    pub fn info(&self) -> LaunchInfo {
        LaunchInfo {
            kinds: [
                AgentKind::Claude,
                AgentKind::Opencode,
                AgentKind::Agy,
                AgentKind::Copilot,
            ]
            .into_iter()
            .filter(|k| binary(*k).and_then(find_in_path).is_some())
            .collect(),
            tmux: self.tmux.is_some(),
            roots: self.roots.iter().map(|r| r.display().to_string()).collect(),
        }
    }

    /// Carpeta permitida: existe, es carpeta y está dentro de una raíz.
    fn allowed_dir(&self, dir: &str) -> Result<PathBuf, &'static str> {
        let p = std::fs::canonicalize(dir).map_err(|_| "esa carpeta no existe")?;
        if !p.is_dir() {
            return Err("eso no es una carpeta");
        }
        if !self.roots.iter().any(|r| p.starts_with(r)) {
            return Err("esa carpeta está fuera de las permitidas (launch_roots en config.toml)");
        }
        Ok(p)
    }

    pub fn list_dirs(&self, path: Option<&str>) -> Result<Listing, &'static str> {
        let dir = match path {
            Some(p) if !p.is_empty() => self.allowed_dir(p)?,
            _ => self
                .roots
                .first()
                .cloned()
                .ok_or("no hay carpetas permitidas")?,
        };
        let mut dirs: Vec<String> = std::fs::read_dir(&dir)
            .map_err(|_| "no se pudo leer esa carpeta")?
            .filter_map(|e| e.ok())
            // Los enlaces a carpetas también cuentan, si su destino sigue dentro de una raíz.
            .filter(|e| {
                let path = e.path();
                std::fs::canonicalize(&path).is_ok_and(|real| {
                    real.is_dir() && self.roots.iter().any(|r| real.starts_with(r))
                })
            })
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.'))
            .collect();
        dirs.sort_by_key(|n| n.to_lowercase());
        dirs.truncate(MAX_DIRS);
        // Solo se puede subir mientras se siga dentro de una raíz.
        let parent = dir
            .parent()
            .filter(|p| self.roots.iter().any(|r| p.starts_with(r)))
            .map(|p| p.display().to_string());
        Ok(Listing {
            path: dir.display().to_string(),
            parent,
            dirs,
        })
    }

    /// Lanza un agente. Devuelve el nombre de su tarjeta.
    pub fn launch(&self, kind: AgentKind, dir: &str, name: Option<&str>) -> Result<String, String> {
        let bin = binary(kind).ok_or("ese tipo de agente no se puede lanzar")?;
        let program = find_in_path(bin).ok_or(format!(
            "`{bin}` no está instalado (o no está en el PATH de argos-board serve)"
        ))?;
        let dir = self.allowed_dir(dir)?;
        let name = match name.map(clean_name).transpose()? {
            Some(n) if !n.is_empty() => n,
            _ => default_name(kind, &dir),
        };
        let args = self.settings.args.get(bin).cloned().unwrap_or_default();
        let launch_id = Uuid::new_v4();

        let mut wrapper = vec![
            self.exe.display().to_string(),
            "run".into(),
            "--port".into(),
            self.port.to_string(),
            "--name".into(),
            name.clone(),
            "--".into(),
            program.display().to_string(),
        ];
        wrapper.extend(args);

        match &self.tmux {
            Some(socket) => {
                let session = self.free_session(socket, &session_name(&name));
                let mut cmd = Command::new("tmux");
                cmd.args(["-L", socket, "new-session", "-d", "-s", &session])
                    .args(["-x", &COLS.to_string(), "-y", &ROWS.to_string()])
                    .arg("-c")
                    .arg(&dir)
                    .args(["-e", &format!("ARGOS_BOARD_LAUNCH_ID={launch_id}")])
                    .args(["-e", &format!("ARGOS_BOARD_TMUX_SESSION={session}")])
                    .args(["-e", &format!("ARGOS_BOARD_TMUX_SOCKET={socket}")]);
                // El servidor de tmux puede venir de otro `serve`: se le pasa lo que
                // decide a qué servidor reporta el wrapper.
                if let Some(cfg) = std::env::var_os("ARGOS_BOARD_CONFIG_DIR") {
                    cmd.arg("-e")
                        .arg(format!("ARGOS_BOARD_CONFIG_DIR={}", cfg.to_string_lossy()));
                }
                let out = cmd
                    .arg("--")
                    .args(&wrapper)
                    .stdin(Stdio::null())
                    .output()
                    .map_err(|e| format!("no se pudo ejecutar tmux: {e}"))?;
                if !out.status.success() {
                    return Err(format!(
                        "tmux no pudo crear la sesión: {}",
                        String::from_utf8_lossy(&out.stderr).trim()
                    ));
                }
            }
            None => {
                let child = Command::new(&wrapper[0])
                    .args(&wrapper[1..])
                    .current_dir(&dir)
                    .env("ARGOS_BOARD_LAUNCH_ID", launch_id.to_string())
                    .env("ARGOS_BOARD_SIZE", format!("{ROWS}x{COLS}"))
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|e| format!("no se pudo lanzar el agente: {e}"))?;
                self.hidden.lock().unwrap().insert(launch_id, child);
                self.reap();
            }
        }
        tracing::info!(kind = bin, dir = %dir.display(), %name, "agente lanzado desde la página");
        Ok(name)
    }

    /// Una sesión que no exista todavía: `argos-x`, `argos-x-2`…
    fn free_session(&self, socket: &str, base: &str) -> String {
        let exists = |s: &str| {
            Command::new("tmux")
                .args(["-L", socket, "has-session", "-t", &format!("={s}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|st| st.success())
        };
        (1..)
            .map(|i| {
                if i == 1 {
                    base.to_string()
                } else {
                    format!("{base}-{i}")
                }
            })
            .find(|s| !exists(s))
            .expect("siempre hay un nombre libre")
    }

    /// Recoge los procesos ocultos que ya terminaron.
    pub fn reap(&self) {
        self.hidden
            .lock()
            .unwrap()
            .retain(|_, c| matches!(c.try_wait(), Ok(None)));
    }

    /// Detiene un agente lanzado desde la página.
    pub fn stop(&self, launch: &LaunchRef) -> Result<(), String> {
        if let Some(session) = &launch.tmux_session {
            let socket = self.tmux.as_ref().ok_or("este servidor no usa tmux")?;
            if !is_our_session(session) {
                return Err("esa sesión no es de argos-board".into());
            }
            let st = Command::new("tmux")
                .args(["-L", socket, "kill-session", "-t", &format!("={session}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|e| format!("no se pudo ejecutar tmux: {e}"))?;
            return if st.success() {
                Ok(())
            } else {
                Err("la sesión de tmux ya no existe".into())
            };
        }
        self.reap();
        let mut hidden = self.hidden.lock().unwrap();
        let child = hidden
            .get_mut(&launch.id)
            .ok_or("no se puede detener: lo lanzó otra ejecución de argos-board serve")?;
        terminate(child);
        Ok(())
    }
}

/// SIGTERM al wrapper: termina al agente y sale reportando el código.
#[cfg(unix)]
fn terminate(child: &mut Child) {
    // SAFETY: kill(2) con el pid de un hijo nuestro que todavía no se recogió.
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
}

#[cfg(not(unix))]
fn terminate(child: &mut Child) {
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launcher_with_root(root: &Path) -> Launcher {
        Launcher {
            settings: LaunchSettings {
                roots: vec![root.to_path_buf()],
                args: HashMap::new(),
            },
            roots: vec![std::fs::canonicalize(root).unwrap()],
            port: 1,
            exe: PathBuf::from("argos-board"),
            tmux: None,
            hidden: Arc::default(),
        }
    }

    #[test]
    fn session_names_are_safe() {
        assert_eq!(
            session_name("claude@Mi Proyecto"),
            "argos-claude-mi-proyecto"
        );
        assert_eq!(session_name("a;rm -rf /"), "argos-a-rm--rf");
        assert!(is_our_session("argos-claude-api-2"));
        assert!(!is_our_session("trabajo"));
        assert!(!is_our_session("argos-x;ls"));
    }

    #[test]
    fn only_dirs_inside_roots() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("proyecto")).unwrap();
        std::fs::create_dir(root.path().join(".oculta")).unwrap();
        std::fs::write(root.path().join("archivo"), "x").unwrap();
        let l = launcher_with_root(root.path());

        let listing = l.list_dirs(None).unwrap();
        assert_eq!(listing.dirs, vec!["proyecto"]);
        assert_eq!(listing.parent, None, "no se sube más allá de la raíz");
        let inner = l
            .list_dirs(Some(&root.path().join("proyecto").display().to_string()))
            .unwrap();
        assert!(inner.parent.is_some());

        assert!(l.allowed_dir("/").is_err());
        let escape = format!("{}/proyecto/../..", root.path().display());
        assert!(l.allowed_dir(&escape).is_err(), "con .. tampoco se sale");
        assert!(
            l.allowed_dir(&root.path().join("archivo").display().to_string())
                .is_err()
        );
        assert!(l.allowed_dir("/no/existe").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_dirs_are_listed_only_if_they_stay_inside_roots() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("real")).unwrap();
        std::os::unix::fs::symlink(root.path().join("real"), root.path().join("atajo")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("fuga")).unwrap();
        std::os::unix::fs::symlink(root.path().join("nada"), root.path().join("rota")).unwrap();
        let l = launcher_with_root(root.path());
        assert_eq!(l.list_dirs(None).unwrap().dirs, vec!["atajo", "real"]);
    }

    #[test]
    fn only_known_kinds_and_clean_names() {
        let root = tempfile::tempdir().unwrap();
        let l = launcher_with_root(root.path());
        let dir = root.path().display().to_string();
        assert!(l.launch(AgentKind::Generic, &dir, None).is_err());
        assert!(clean_name(&"x".repeat(61)).is_err());
        assert_eq!(clean_name(" mi\u{1b}agente ").unwrap(), "miagente");
        assert_eq!(
            default_name(AgentKind::Claude, Path::new("/home/u/api")),
            "claude@api"
        );
    }
}
