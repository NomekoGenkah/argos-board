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
    Copilot,
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
            "copilot" => Self::Copilot,
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
    /// Versión del wrapper que reporta (`None` si es anterior a este campo).
    pub version: Option<String>,
    /// Si el wrapper acepta entrada desde la web (`false` con `--no-input`,
    /// `allow_input = false` o un wrapper anterior a esta función).
    pub accepts_input: bool,
    /// Si se lanzó desde la página: cómo detenerlo y, si corre en tmux, su sesión.
    pub launch: Option<LaunchRef>,
}

/// Agente lanzado desde la página (lo informa el wrapper; se lo pasa `serve`
/// por variables de entorno al lanzarlo).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaunchRef {
    pub id: Uuid,
    /// Sesión de tmux (en el socket de argos-board) donde corre, si corre en tmux.
    pub tmux_session: Option<String>,
    /// Comando para tomarlo desde una terminal.
    pub attach: Option<String>,
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
        /// Versión del wrapper. Opcional: los wrappers viejos no la mandan.
        #[serde(default)]
        version: Option<String>,
        /// Acepta entrada desde la web. Los wrappers viejos no la mandan: no.
        #[serde(default)]
        accepts_input: bool,
        /// Lanzado desde la página.
        #[serde(default)]
        launch: Option<LaunchRef>,
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

/// Tecla que la web puede mandar a un agente. Es una lista cerrada: el
/// navegador nunca manda bytes crudos; el wrapper traduce cada tecla.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Key {
    Enter,
    Esc,
    Tab,
    ShiftTab,
    Up,
    Down,
    Left,
    Right,
    Backspace,
    CtrlC,
    CtrlD,
}

/// Tope de texto por mensaje de entrada.
pub const MAX_INPUT_TEXT: usize = 4096;

/// Entrada desde la web para un agente: texto (y, si `submit`, Enter después)
/// o una tecla.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Input {
    Text {
        text: String,
        #[serde(default)]
        submit: bool,
    },
    Key {
        key: Key,
    },
}

impl Input {
    /// Quita los caracteres de control del texto (salvo salto de línea y
    /// tabulación: una secuencia de escape podría manejar la terminal) y
    /// rechaza lo vacío o demasiado grande.
    pub fn sanitized(self) -> Result<Input, &'static str> {
        match self {
            Input::Text { text, submit } => {
                if text.len() > MAX_INPUT_TEXT {
                    return Err("el texto es demasiado largo");
                }
                let text: String = text
                    .chars()
                    .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
                    .collect();
                if text.is_empty() && !submit {
                    return Err("no hay nada que enviar");
                }
                Ok(Input::Text { text, submit })
            }
            key => Ok(key),
        }
    }

    /// Para los logs: qué tipo de entrada fue y cuántos bytes, nunca el contenido.
    pub fn describe(&self) -> (&'static str, usize) {
        match self {
            Input::Text { text, .. } => ("texto", text.len()),
            Input::Key { .. } => ("tecla", 0),
        }
    }
}

/// Mensajes servidor → wrapper (por la misma conexión `/ingest`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WrapperCmd {
    Input { input: Input },
}

/// Mensajes navegador → servidor (`/ws`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FromBrowser {
    /// Presenta el token de un dispositivo emparejado o, desde la propia máquina,
    /// el token de control (el del enlace que imprime `serve`).
    Auth { token: String },
    /// `rid` identifica la petición en la respuesta `input_result`.
    Input { id: Uuid, rid: u64, input: Input },
    /// Subcarpetas de `path` (o de la primera raíz permitida), para elegir dónde lanzar.
    ListDirs { rid: u64, path: Option<String> },
    /// Lanza un agente de un tipo conocido en una carpeta permitida.
    Launch {
        rid: u64,
        kind: AgentKind,
        dir: String,
        #[serde(default)]
        name: Option<String>,
    },
    /// Detiene un agente lanzado desde la página.
    Stop { rid: u64, id: Uuid },
    /// Precalienta el transcriptor de voz (tarda unos 10 s en frío); no hace falta pedirlo.
    VoicePrepare,
    /// Empieza a dictar: a continuación la página manda el audio en mensajes binarios
    /// (PCM de 16 kHz, 16 bits, mono, little-endian).
    VoiceStart,
    /// Termina de dictar: se espera el texto final.
    VoiceStop,
    /// Descarta el dictado en curso.
    VoiceCancel,
}

/// Qué se puede lanzar desde esta página (se manda tras autorizarla).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LaunchInfo {
    /// Tipos de agente instalados.
    pub kinds: Vec<AgentKind>,
    /// Si los agentes lanzados corren en tmux (y se pueden tomar desde una terminal).
    pub tmux: bool,
    /// Carpetas dentro de las que se puede lanzar.
    pub roots: Vec<String>,
}

/// Fase del dictado por voz en el servidor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceState {
    /// Arrancando el transcriptor (solo la primera vez, o tras un rato sin uso).
    Preparing,
    /// Escuchando: el audio que llegue se transcribe.
    Recording,
    /// Se pidió terminar: el servidor espera el texto final.
    Finishing,
    Idle,
}

/// Mensajes servidor → navegador (`/ws`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BrowserMsg {
    Snapshot {
        agents: Vec<AgentSnapshot>,
        /// Versión del servidor, para que la página detecte wrappers de otra versión.
        server_version: &'static str,
    },
    AgentAdded {
        agent: AgentSnapshot,
    },
    AgentUpdated {
        agent: AgentSnapshot,
    },
    AgentRemoved {
        id: Uuid,
    },
    /// Esta conexión viene de la red: no recibe nada hasta autenticarse con el token
    /// de un dispositivo emparejado.
    AuthRequired,
    /// Respuesta a `auth`: con `ok`, esta conexión puede escribir en los agentes.
    AuthResult {
        ok: bool,
    },
    /// Tras `auth` correcto: qué se puede lanzar.
    LaunchInfo {
        info: LaunchInfo,
    },
    /// Respuesta a `list_dirs`.
    Dirs {
        rid: u64,
        ok: bool,
        path: String,
        parent: Option<String>,
        dirs: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// Tras autenticarse: si el servidor puede transcribir voz (hay un `agy` instalado).
    VoiceInfo {
        available: bool,
    },
    VoiceState {
        state: VoiceState,
    },
    /// Texto del dictado: provisional mientras se habla y, con `is_final`, el definitivo.
    VoiceText {
        text: String,
        is_final: bool,
    },
    VoiceError {
        message: String,
    },
    /// Respuesta a `launch` y `stop`.
    ActionResult {
        rid: u64,
        ok: bool,
        /// Nombre del agente lanzado.
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// Respuesta a `input`.
    InputResult {
        rid: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
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
        assert_eq!(
            AgentKind::from_program("/usr/local/bin/copilot"),
            AgentKind::Copilot
        );
        assert_eq!(AgentKind::from_program("bash"), AgentKind::Generic);
    }

    #[test]
    fn input_wire_format_and_sanitizing() {
        let i: Input =
            serde_json::from_str(r#"{"type":"text","text":"hola\u001b[2Jmundo\n","submit":true}"#)
                .unwrap();
        assert_eq!(
            i.sanitized().unwrap(),
            Input::Text {
                text: "hola[2Jmundo\n".into(),
                submit: true
            }
        );
        let k: Input = serde_json::from_str(r#"{"type":"key","key":"ctrl_c"}"#).unwrap();
        assert_eq!(k, Input::Key { key: Key::CtrlC });
        // Teclas fuera de la lista: no se aceptan.
        assert!(serde_json::from_str::<Input>(r#"{"type":"key","key":"f12"}"#).is_err());
        assert!(serde_json::from_str::<Input>(r#"{"type":"raw","bytes":[27]}"#).is_err());
        let long = Input::Text {
            text: "x".repeat(MAX_INPUT_TEXT + 1),
            submit: false,
        };
        assert!(long.sanitized().is_err());
        let empty = Input::Text {
            text: "\u{7}".into(),
            submit: false,
        };
        assert!(empty.sanitized().is_err());
        let msg: FromBrowser = serde_json::from_str(
            r#"{"type":"input","id":"7f1d6a3e-1111-4222-8333-944455556666","rid":4,"input":{"type":"key","key":"enter"}}"#,
        )
        .unwrap();
        assert!(matches!(msg, FromBrowser::Input { rid: 4, .. }));
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
