//! Estado en memoria de todos los agentes + difusión a los navegadores.

use crate::model::{AgentSnapshot, AgentState, BrowserMsg, IngestMsg};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
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
        } = msg
        {
            let (event_new, entry) = match agents.remove(&id) {
                Some(mut e) => {
                    e.snap.name = name;
                    e.snap.kind = kind;
                    e.snap.project = project;
                    e.snap.started_at = started_at;
                    e.snap.git_branch = git_branch;
                    if e.snap.state == AgentState::Disconnected {
                        e.snap.state = AgentState::Idle;
                        e.snap.state_since = now;
                    }
                    e.conn = conn;
                    e.ended_at = None;
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
                            last_output_at: None,
                        },
                        conn,
                        ended_at: None,
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
                last_output_at,
            } => {
                e.snap.last_lines = last_lines;
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

    /// La conexión `conn` se cerró. Si no hubo `exit`, el agente queda `disconnected`.
    pub fn connection_closed(&self, conn: u64, agent: Uuid) {
        let mut agents = self.agents.lock().unwrap();
        let Some(e) = agents.get_mut(&agent) else {
            return;
        };
        if e.conn != conn || e.snap.state == AgentState::Exited {
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
        }
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
}
