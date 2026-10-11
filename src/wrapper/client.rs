//! Cliente de ingesta: envía eventos al servidor y se reconecta en segundo
//! plano. Nunca bloquea al agente ni escribe en la terminal.

use crate::config;
use crate::model::IngestMsg;
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// Último valor conocido de cada tipo de evento, para reenviar el estado
/// completo tras una reconexión.
#[derive(Default)]
struct Cache {
    hello: Option<IngestMsg>,
    state: Option<IngestMsg>,
    screen: Option<IngestMsg>,
    git: Option<IngestMsg>,
    exit: Option<IngestMsg>,
}

impl Cache {
    fn store(&mut self, m: &IngestMsg) {
        let slot = match m {
            IngestMsg::Hello { .. } => &mut self.hello,
            IngestMsg::State { .. } => &mut self.state,
            IngestMsg::Screen { .. } => &mut self.screen,
            IngestMsg::Git { .. } => &mut self.git,
            IngestMsg::Exit { .. } => &mut self.exit,
        };
        *slot = Some(m.clone());
    }

    fn all(&self) -> impl Iterator<Item = &IngestMsg> {
        [
            &self.hello,
            &self.state,
            &self.git,
            &self.screen,
            &self.exit,
        ]
        .into_iter()
        .flatten()
    }
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(port: u16) -> Option<Ws> {
    let token = config::read_token()?;
    let mut req = format!("ws://127.0.0.1:{port}/ingest")
        .into_client_request()
        .ok()?;
    req.headers_mut()
        .insert("authorization", format!("Bearer {token}").parse().ok()?);
    let (ws, _) = tokio::time::timeout(
        Duration::from_secs(2),
        tokio_tungstenite::connect_async(req),
    )
    .await
    .ok()?
    .ok()?;
    Some(ws)
}

fn encode(m: &IngestMsg) -> Message {
    Message::text(serde_json::to_string(m).expect("IngestMsg serializable"))
}

/// Termina cuando se cierra `rx` (el wrapper está saliendo).
pub async fn run(port: u16, mut rx: UnboundedReceiver<IngestMsg>) {
    let mut cache = Cache::default();
    let mut backoff = Duration::from_millis(250);
    loop {
        if let Some(mut ws) = connect(port).await {
            tracing::info!(port, "conectado al servidor");
            backoff = Duration::from_millis(250);
            let mut ok = true;
            for m in cache.all() {
                if ws.send(encode(m)).await.is_err() {
                    ok = false;
                    break;
                }
            }
            while ok {
                tokio::select! {
                    m = rx.recv() => match m {
                        Some(m) => {
                            cache.store(&m);
                            ok = ws.send(encode(&m)).await.is_ok();
                        }
                        None => {
                            let _ = ws.close(None).await;
                            return;
                        }
                    },
                    incoming = ws.next() => match incoming {
                        Some(Ok(_)) => {}
                        _ => ok = false,
                    },
                }
            }
        }
        tracing::debug!(port, ?backoff, "sin conexión con el servidor; se reintenta");
        // Espera con backoff sin dejar de consumir eventos.
        let sleep = tokio::time::sleep(backoff);
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                _ = &mut sleep => break,
                m = rx.recv() => match m {
                    Some(m) => cache.store(&m),
                    None => return,
                },
            }
        }
        backoff = (backoff * 2).min(Duration::from_secs(5));
    }
}
