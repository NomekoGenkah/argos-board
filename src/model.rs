//! Modelo de datos compartido entre wrapper, servidor y navegador.
//!
//! `AgentSnapshot` es el contrato estable de la sección 4 de la spec: lo
//! consume la página actual y lo consumirá la futura skin pixel-art.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Claude,
    Opencode,
    Agy,
    Generic,
}

impl AgentKind {
    /// Perfil de detección según el nombre del binario.
    pub fn from_program(program: &str) -> Self {
        let base = std::path::Path::new(program)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(program);
        match base {
            "claude" => Self::Claude,
            "opencode" => Self::Opencode,
            "agy" => Self::Agy,
            _ => Self::Generic,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Working,
    /// Pide permiso para usar una herramienta.
    WaitingApproval,
    /// Hizo una pregunta (p. ej. un menú de opciones) y espera la respuesta.
    WaitingInput,
    Idle,
    Error,
    Exited,
    Disconnected,
}

impl AgentState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::WaitingApproval => "waiting_approval",
            Self::WaitingInput => "waiting_input",
            Self::Idle => "idle",
            Self::Error => "error",
            Self::Exited => "exited",
            Self::Disconnected => "disconnected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub id: Uuid,
    pub name: String,
    pub kind: AgentKind,
    pub state: AgentState,
    pub state_since: DateTime<Utc>,
    pub started_at: DateTime<Utc>,
    pub project: String,
    pub git_branch: String,
    pub last_lines: Vec<String>,
    pub last_output_at: Option<DateTime<Utc>>,
}

/// Mensajes wrapper → servidor (`/ingest`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IngestMsg {
    Hello {
        id: Uuid,
        name: String,
        kind: AgentKind,
        project: String,
        pid: Option<u32>,
        started_at: DateTime<Utc>,
        git_branch: String,
    },
    Screen {
        last_lines: Vec<String>,
        last_output_at: Option<DateTime<Utc>>,
    },
    State {
        state: AgentState,
        since: DateTime<Utc>,
    },
    Git {
        branch: String,
    },
    Exit {
        code: i32,
    },
}

/// Mensajes servidor → navegador (`/ws`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BrowserMsg {
    Snapshot { agents: Vec<AgentSnapshot> },
    AgentAdded { agent: AgentSnapshot },
    AgentUpdated { agent: AgentSnapshot },
    AgentRemoved { id: Uuid },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_from_program() {
        assert_eq!(AgentKind::from_program("claude"), AgentKind::Claude);
        assert_eq!(
            AgentKind::from_program("/home/u/.opencode/bin/opencode"),
            AgentKind::Opencode
        );
        assert_eq!(AgentKind::from_program("agy"), AgentKind::Agy);
        assert_eq!(AgentKind::from_program("bash"), AgentKind::Generic);
    }

    #[test]
    fn ingest_msg_wire_format() {
        let json = serde_json::to_value(IngestMsg::Exit { code: 3 }).unwrap();
        assert_eq!(json, serde_json::json!({"type": "exit", "code": 3}));
        let state = serde_json::to_value(AgentState::WaitingApproval).unwrap();
        assert_eq!(state, "waiting_approval");
        let state: AgentState = serde_json::from_value(serde_json::json!("waiting_input")).unwrap();
        assert_eq!(state, AgentState::WaitingInput);
        assert_eq!(state.as_str(), "waiting_input");
    }
}
