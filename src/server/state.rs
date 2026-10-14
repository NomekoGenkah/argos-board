//! Estado en memoria de todos los agentes + difusión a los navegadores.

use crate::model::{AgentSnapshot, AgentState, BrowserMsg, IngestMsg, Input, WrapperCmd};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

/// Tiempo que una tarjeta `exited`/`disconnected` sigue visible.
pub const EXPIRY: Duration = Duration::from_secs(10 * 60);

struct Entry {
    snap: AgentSnapshot,
    /// Generación de la conexión de ingesta dueña de esta entrada; evita que el
    /// cierre de una conexión vieja marque como desconectado a un wrapper que
    /// ya se reconectó.
    conn: u64,
    ended_at: Option<Instant>,
    /// Canal hacia el wrapper (su conexión de ingesta), para la entrada desde la web.
    input: Option<mpsc::UnboundedSender<WrapperCmd>>,
}

pub struct Board {
    agents: Mutex<HashMap<Uuid, Entry>>,
    tx: broadcast::Sender<BrowserMsg>,
    next_conn: std::sync::atomic::AtomicU64,
}

impl Default for Board {
    fn default() -> Self {
        Self::new()
    }
}

impl Board {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            agents: Mutex::new(HashMap::new()),
            tx,
            next_conn: std::sync::atomic::AtomicU64::new(1),
        }
    }

    pub fn new_conn(&self) -> u64 {
        self.next_conn
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> Vec<AgentSnapshot> {
        let agents = self.agents.lock().unwrap();
        let mut v: Vec<_> = agents.values().map(|e| e.snap.clone()).collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }

    /// Suscripción + snapshot consistentes (bajo el mismo lock).
    pub fn subscribe(&self) -> (Vec<AgentSnapshot>, broadcast::Receiver<BrowserMsg>) {
        let agents = self.agents.lock().unwrap();
        let rx = self.tx.subscribe();
        let snap = agents.values().map(|e| e.snap.clone()).collect();
        (snap, rx)
    }

    /// Aplica un mensaje de la conexión `conn`. Devuelve el id del agente si
    /// el mensaje fue un `hello`.
    pub fn apply(&self, conn: u64, agent: Option<Uuid>, msg: IngestMsg) -> Option<Uuid> {
        let mut agents = self.agents.lock().unwrap();
        let now = Utc::now();
        if let IngestMsg::Hello {
            id,
            name,
            kind,
            project,
            pid: _,
            started_at,
            git_branch,
            version,
            accepts_input,
            launch,
        } = msg
        {
            let (event_new, entry) = match agents.remove(&id) {
                Some(mut e) => {
                    e.snap.name = name;
                    e.snap.kind = kind;
                    e.snap.project = project;
                    e.snap.started_at = started_at;
                    e.snap.git_branch = git_branch;
                    e.snap.version = version;
                    e.snap.accepts_input = accepts_input;
                    e.snap.launch = launch;
                    e.input = None;
                    if e.snap.state == AgentState::Disconnected {
                        e.snap.state = AgentState::Idle;
                        e.snap.state_since = now;
                    }
                    e.conn = conn;
                    // Un agente ya terminado sigue su cuenta atrás para quitarse del tablero.
                    if e.snap.state != AgentState::Exited {
                        e.ended_at = None;
                    }
                    (false, e)
                }
                None => (
                    true,
                    Entry {
                        snap: AgentSnapshot {
                            id,
                            name,
                            kind,
                            state: AgentState::Idle,
                            state_since: now,
                            started_at,
                            project,
                            git_branch,
                            last_lines: Vec::new(),
                            grid: None,
                            last_output_at: None,
                            version,
                            accepts_input,
                            launch,
                        },
                        conn,
                        ended_at: None,
                        input: None,
                    },
                ),
            };
            let snap = entry.snap.clone();
            agents.insert(id, entry);
            let _ = self.tx.send(if event_new {
                BrowserMsg::AgentAdded { agent: snap }
            } else {
                BrowserMsg::AgentUpdated { agent: snap }
            });
            return Some(id);
        }

        let id = agent?;
        let e = agents.get_mut(&id)?;
        if e.conn != conn {
            return None;
        }
        let before = e.snap.clone();
        match msg {
            IngestMsg::Hello { .. } => unreachable!(),
            IngestMsg::Screen {
                last_lines,
                grid,
                last_output_at,
            } => {
                e.snap.last_lines = last_lines;
                e.snap.grid = grid;
                e.snap.last_output_at = last_output_at;
            }
            IngestMsg::State { state, since } => {
                if e.snap.state != AgentState::Exited && e.snap.state != state {
                    e.snap.state = state;
                    e.snap.state_since = since;
                }
            }
            IngestMsg::Git { branch } => e.snap.git_branch = branch,
            IngestMsg::Exit { code: _ } => {
                if e.snap.state != AgentState::Exited {
                    e.snap.state = AgentState::Exited;
                    e.snap.state_since = now;
                    e.ended_at = Some(Instant::now());
                }
            }
        }
        if e.snap != before {
            let _ = self.tx.send(BrowserMsg::AgentUpdated {
                agent: e.snap.clone(),
            });
        }
        None
    }

    /// Canal por el que la conexión `conn` recibe la entrada para `agent`.
    pub fn attach_input(&self, conn: u64, agent: Uuid, tx: mpsc::UnboundedSender<WrapperCmd>) {
        let mut agents = self.agents.lock().unwrap();
        if let Some(e) = agents.get_mut(&agent).filter(|e| e.conn == conn) {
            e.input = Some(tx);
        }
    }

    /// Cómo se lanzó un agente desde la página (si fue así) y si sigue vivo.
    pub fn launch_of(&self, agent: Uuid) -> Option<(crate::model::LaunchRef, AgentState)> {
        let agents = self.agents.lock().unwrap();
        let e = agents.get(&agent)?;
        Some((e.snap.launch.clone()?, e.snap.state))
    }

    /// Manda entrada (ya validada) al wrapper de un agente.
    pub fn send_input(&self, agent: Uuid, input: Input) -> Result<(), &'static str> {
        let agents = self.agents.lock().unwrap();
        let e = agents.get(&agent).ok_or("ese agente ya no está")?;
        match e.snap.state {
            AgentState::Exited => return Err("el agente terminó"),
            AgentState::Disconnected => return Err("el agente está desconectado"),
            _ => {}
        }
        if !e.snap.accepts_input {
            return Err("este agente no acepta entrada desde la web");
        }
        let tx = e.input.as_ref().ok_or("el agente está desconectado")?;
        tx.send(WrapperCmd::Input { input })
            .map_err(|_| "el agente está desconectado")
    }

    /// Devuelve la ruta del proyecto si el agente existe, está activo y acepta entrada.
    pub fn upload_target(&self, agent: Uuid) -> Result<std::path::PathBuf, &'static str> {
        let agents = self.agents.lock().unwrap();
        let e = agents.get(&agent).ok_or("ese agente ya no está")?;
        match e.snap.state {
            AgentState::Exited => return Err("el agente terminó"),
            AgentState::Disconnected => return Err("el agente está desconectado"),
            _ => {}
        }
        if !e.snap.accepts_input {
            return Err("este agente no acepta entrada desde la web");
        }
        Ok(std::path::PathBuf::from(&e.snap.project))
    }

    /// La conexión `conn` se cerró. Si no hubo `exit`, el agente queda `disconnected`.
    pub fn connection_closed(&self, conn: u64, agent: Uuid) {
        let mut agents = self.agents.lock().unwrap();
        let Some(e) = agents.get_mut(&agent) else {
            return;
        };
        if e.conn != conn {
            return;
        }
        e.input = None;
        if e.snap.state == AgentState::Exited {
            return;
        }
        e.snap.state = AgentState::Disconnected;
        e.snap.state_since = Utc::now();
        e.ended_at = Some(Instant::now());
        let _ = self.tx.send(BrowserMsg::AgentUpdated {
            agent: e.snap.clone(),
        });
    }

    /// Elimina tarjetas terminadas hace más de `max_age`.
    pub fn sweep(&self, max_age: Duration) {
        let mut agents = self.agents.lock().unwrap();
        let expired: Vec<Uuid> = agents
            .iter()
            .filter(|(_, e)| e.ended_at.is_some_and(|t| t.elapsed() >= max_age))
            .map(|(id, _)| *id)
            .collect();
        for id in expired {
            agents.remove(&id);
            let _ = self.tx.send(BrowserMsg::AgentRemoved { id });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::AgentKind;

    fn hello(id: Uuid) -> IngestMsg {
        IngestMsg::Hello {
            id,
            name: "fake@proj".into(),
            kind: AgentKind::Generic,
            project: "/tmp/proj".into(),
            pid: Some(1),
            started_at: Utc::now(),
            git_branch: "main".into(),
            version: Some("0.0.0 (test)".into()),
            accepts_input: true,
            launch: None,
        }
    }

    #[test]
    fn input_routing() {
        let b = Board::new();
        let id = Uuid::new_v4();
        let c1 = b.new_conn();
        b.apply(c1, None, hello(id));
        let text = || Input::Text {
            text: "hola".into(),
            submit: true,
        };
        // Sin canal todavía (o sin agente): error, nunca pánico.
        assert!(b.send_input(Uuid::new_v4(), text()).is_err());
        assert!(b.send_input(id, text()).is_err());
        let (tx, mut rx) = mpsc::unbounded_channel();
        // Una conexión vieja no puede engancharse a la entrada.
        b.attach_input(c1 + 99, id, tx.clone());
        assert!(b.send_input(id, text()).is_err());
        b.attach_input(c1, id, tx);
        b.send_input(id, text()).unwrap();
        assert_eq!(rx.try_recv().unwrap(), WrapperCmd::Input { input: text() });
        // Terminado o desconectado: ya no se escribe.
        b.connection_closed(c1, id);
        assert_eq!(b.send_input(id, text()), Err("el agente está desconectado"));
        // Un wrapper con --no-input rechaza siempre.
        let id2 = Uuid::new_v4();
        let c2 = b.new_conn();
        let mut h = hello(id2);
        if let IngestMsg::Hello { accepts_input, .. } = &mut h {
            *accepts_input = false;
        }
        b.apply(c2, None, h);
        let (tx, _rx) = mpsc::unbounded_channel();
        b.attach_input(c2, id2, tx);
        assert_eq!(
            b.send_input(id2, text()),
            Err("este agente no acepta entrada desde la web")
        );
    }

    #[test]
    fn lifecycle_and_reconnect() {
        let b = Board::new();
        let id = Uuid::new_v4();
        let c1 = b.new_conn();
        assert_eq!(b.apply(c1, None, hello(id)), Some(id));
        b.apply(
            c1,
            Some(id),
            IngestMsg::State {
                state: AgentState::Working,
                since: Utc::now(),
            },
        );
        assert_eq!(b.snapshot()[0].state, AgentState::Working);

        // Se cae la conexión sin exit → disconnected.
        b.connection_closed(c1, id);
        assert_eq!(b.snapshot()[0].state, AgentState::Disconnected);

        // Reconecta con el mismo id → misma tarjeta, sin duplicados.
        let c2 = b.new_conn();
        b.apply(c2, None, hello(id));
        assert_eq!(b.snapshot().len(), 1);
        assert_ne!(b.snapshot()[0].state, AgentState::Disconnected);

        // Un cierre tardío de la conexión vieja no afecta a la nueva.
        b.connection_closed(c1, id);
        assert_ne!(b.snapshot()[0].state, AgentState::Disconnected);

        b.apply(c2, Some(id), IngestMsg::Exit { code: 0 });
        b.connection_closed(c2, id);
        assert_eq!(b.snapshot()[0].state, AgentState::Exited);

        b.sweep(Duration::ZERO);
        assert!(b.snapshot().is_empty());
    }

    #[test]
    fn exited_agent_is_still_swept_after_a_late_hello() {
        let b = Board::new();
        let id = Uuid::new_v4();
        let c1 = b.new_conn();
        b.apply(c1, None, hello(id));
        b.apply(c1, Some(id), IngestMsg::Exit { code: 0 });
        // Un hello tardío (reintento del wrapper) no debe dejar la tarjeta para siempre.
        let c2 = b.new_conn();
        b.apply(c2, None, hello(id));
        assert_eq!(b.snapshot()[0].state, AgentState::Exited);
        b.sweep(Duration::ZERO);
        assert!(b.snapshot().is_empty());
    }

    #[test]
    fn upload_target_requires_active_agent_and_accepts_input() {
        let b = Board::new();
        let id = Uuid::new_v4();
        // Agente no existe
        assert!(b.upload_target(id).is_err());
        // Agente que no acepta entrada
        let c1 = b.new_conn();
        b.apply(
            c1,
            None,
            IngestMsg::Hello {
                id,
                name: "test".into(),
                kind: AgentKind::Claude,
                project: "/tmp/project1".into(),
                pid: None,
                started_at: Utc::now(),
                git_branch: "main".into(),
                version: None,
                accepts_input: false,
                launch: None,
            },
        );
        assert_eq!(
            b.upload_target(id).err().unwrap(),
            "este agente no acepta entrada desde la web"
        );
        // Agente que sí acepta entrada
        let id2 = Uuid::new_v4();
        let c2 = b.new_conn();
        b.apply(
            c2,
            None,
            IngestMsg::Hello {
                id: id2,
                name: "test2".into(),
                kind: AgentKind::Claude,
                project: "/tmp/project2".into(),
                pid: None,
                started_at: Utc::now(),
                git_branch: "main".into(),
                version: None,
                accepts_input: true,
                launch: None,
            },
        );
        assert_eq!(
            b.upload_target(id2).unwrap(),
            std::path::PathBuf::from("/tmp/project2")
        );
    }
}
