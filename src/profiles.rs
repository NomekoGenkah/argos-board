//! Perfiles de detección: patrones de pantalla por agente que identifican
//! `waiting_input`, `waiting_approval` y `error`.

use crate::model::{AgentKind, AgentState};
use regex::Regex;
use serde::Deserialize;
use std::collections::HashMap;

const DEFAULTS: &str = include_str!("profiles.toml");

/// Solo se miran las últimas líneas de la pantalla: los menús y diálogos que
/// esperan al usuario están abajo, y así no coincide texto viejo del historial.
pub const TAIL_LINES: usize = 25;

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    profiles: HashMap<String, RawProfile>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProfile {
    waiting_input: Option<Vec<String>>,
    waiting_approval: Option<Vec<String>>,
    error: Option<Vec<String>>,
}

#[derive(Debug, Default)]
pub struct Profile {
    waiting_input: Vec<Regex>,
    waiting_approval: Vec<Regex>,
    error: Vec<Regex>,
}

fn kind_key(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Opencode => "opencode",
        AgentKind::Agy => "agy",
        AgentKind::Copilot => "copilot",
        AgentKind::Generic => "generic",
    }
}

fn compile(patterns: &[String], what: &str, warnings: &mut Vec<String>) -> Option<Vec<Regex>> {
    let mut out = Vec::with_capacity(patterns.len());
    for p in patterns {
        match Regex::new(p) {
            Ok(re) => out.push(re),
            Err(e) => {
                warnings.push(format!("patrón inválido en {what} ({p:?}): {e}"));
                return None;
            }
        }
    }
    Some(out)
}

impl Profile {
    /// Perfil para `kind`: valores por defecto con las listas que el usuario
    /// reemplace en `user_toml`. Los errores del usuario no son fatales: se
    /// devuelven como avisos y se usan los valores por defecto.
    pub fn build(kind: AgentKind, user_toml: Option<&str>) -> (Profile, Vec<String>) {
        let key = kind_key(kind);
        let mut warnings = Vec::new();
        let defaults: ConfigFile = toml::from_str(DEFAULTS).expect("profiles.toml embebido válido");
        let base = defaults
            .profiles
            .get(key)
            .expect("perfil por defecto para cada kind");
        let user: Option<RawProfile> =
            user_toml.and_then(|text| match toml::from_str::<ConfigFile>(text) {
                Ok(mut cfg) => cfg.profiles.remove(key),
                Err(e) => {
                    warnings.push(format!(
                        "config.toml inválido, se usan los perfiles por defecto: {e}"
                    ));
                    None
                }
            });

        let mut pick = |field: &str, default: &Option<Vec<String>>, over: Option<&Vec<String>>| {
            let what = format!("profiles.{key}.{field}");
            let defaults = || {
                compile(
                    default.as_deref().unwrap_or_default(),
                    &what,
                    &mut Vec::new(),
                )
                .expect("defaults válidos")
            };
            match over {
                Some(list) => compile(list, &what, &mut warnings).unwrap_or_else(defaults),
                None => defaults(),
            }
        };
        let u = user.as_ref();
        let profile = Profile {
            waiting_input: pick(
                "waiting_input",
                &base.waiting_input,
                u.and_then(|p| p.waiting_input.as_ref()),
            ),
            waiting_approval: pick(
                "waiting_approval",
                &base.waiting_approval,
                u.and_then(|p| p.waiting_approval.as_ref()),
            ),
            error: pick("error", &base.error, u.and_then(|p| p.error.as_ref())),
        };
        (profile, warnings)
    }

    /// Lee `config.toml` del directorio de configuración, si existe.
    pub fn load(kind: AgentKind) -> (Profile, Vec<String>) {
        Self::build(kind, crate::config::user_config().as_deref())
    }

    /// Estado que indica la pantalla, si algún patrón coincide.
    /// Prioridad: permiso > pregunta > error.
    pub fn classify(&self, screen: &str) -> Option<AgentState> {
        let lines: Vec<&str> = screen.lines().collect();
        let end = lines
            .iter()
            .rposition(|l| !l.trim().is_empty())
            .map_or(0, |i| i + 1);
        let tail = lines[end.saturating_sub(TAIL_LINES)..end].join("\n");
        let hit = |res: &[Regex]| res.iter().any(|re| re.is_match(&tail));
        if hit(&self.waiting_approval) {
            Some(AgentState::WaitingApproval)
        } else if hit(&self.waiting_input) {
            Some(AgentState::WaitingInput)
        } else if hit(&self.error) {
            Some(AgentState::Error)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn fixture(agent: &str, name: &str) -> (String, String) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("tests/fixtures/screens/{agent}/{name}"));
        let text = std::fs::read_to_string(&path).unwrap();
        let (head, body) = text.split_once("\n---\n").unwrap();
        let category = head
            .lines()
            .find_map(|l| l.strip_prefix("# categoria: "))
            .unwrap()
            .to_string();
        (category, body.to_string())
    }

    /// Estado esperado por categoría de fixture.
    fn expected(category: &str) -> Option<AgentState> {
        match category {
            "pregunta" | "confianza" => Some(AgentState::WaitingInput),
            "permiso" => Some(AgentState::WaitingApproval),
            "fin_de_turno" => None,
            other => panic!("categoría desconocida {other}"),
        }
    }

    #[test]
    fn every_fixture_is_classified_as_expected() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/screens");
        let mut checked = 0;
        for (agent, kind) in [
            ("claude", AgentKind::Claude),
            ("opencode", AgentKind::Opencode),
            ("agy", AgentKind::Agy),
            ("copilot", AgentKind::Copilot),
        ] {
            let (profile, warnings) = Profile::build(kind, None);
            assert!(warnings.is_empty(), "{warnings:?}");
            for entry in std::fs::read_dir(root.join(agent)).unwrap() {
                let name = entry.unwrap().file_name().into_string().unwrap();
                let (category, body) = fixture(agent, &name);
                assert_eq!(
                    profile.classify(&body),
                    expected(&category),
                    "{agent}/{name} ({category})"
                );
                checked += 1;
            }
        }
        assert!(checked >= 12, "solo {checked} fixtures");
    }

    #[test]
    fn generic_profile_detects_nothing() {
        let (profile, _) = Profile::build(AgentKind::Generic, None);
        let (_, body) = fixture("claude", "pregunta-opciones.txt");
        assert_eq!(profile.classify(&body), None);
    }

    #[test]
    fn user_config_replaces_only_given_lists() {
        let user = r#"
            [profiles.generic]
            waiting_input = ['\(y/n\)']
            [profiles.claude]
            error = ['usage limit']
        "#;
        let (generic, w) = Profile::build(AgentKind::Generic, Some(user));
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(
            generic.classify("¿Aprobar el cambio? (y/n) "),
            Some(AgentState::WaitingInput)
        );

        let (claude, _) = Profile::build(AgentKind::Claude, Some(user));
        assert_eq!(
            claude.classify("Claude usage limit reached"),
            Some(AgentState::Error)
        );
        // waiting_input de claude sigue siendo el por defecto.
        let (_, body) = fixture("claude", "pregunta-opciones.txt");
        assert_eq!(claude.classify(&body), Some(AgentState::WaitingInput));
    }

    #[test]
    fn invalid_user_config_falls_back_to_defaults() {
        let (claude, w) = Profile::build(AgentKind::Claude, Some("esto no es [toml"));
        assert_eq!(w.len(), 1, "{w:?}");
        let (_, body) = fixture("claude", "pregunta-opciones.txt");
        assert_eq!(claude.classify(&body), Some(AgentState::WaitingInput));

        let (claude, w) = Profile::build(
            AgentKind::Claude,
            Some("[profiles.claude]\nwaiting_input = ['(sin cerrar']"),
        );
        assert_eq!(w.len(), 1, "{w:?}");
        assert_eq!(
            claude.classify(&body),
            Some(AgentState::WaitingInput),
            "regex inválida → defaults"
        );

        let (_, w) = Profile::build(
            AgentKind::Claude,
            Some("[profiles.claude]\nwaitng_input = []"),
        );
        assert_eq!(w.len(), 1, "clave mal escrita: {w:?}");
    }

    #[test]
    fn only_the_bottom_of_the_screen_counts() {
        let (claude, _) = Profile::build(AgentKind::Claude, None);
        let mut screen = String::from("Enter to select · ↑/↓ to navigate\n");
        screen.push_str(&"historial\n".repeat(TAIL_LINES + 5));
        assert_eq!(claude.classify(&screen), None);
    }
}
