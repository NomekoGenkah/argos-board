//! `argos-board serve`: HTTP + WebSocket en 127.0.0.1.

pub mod state;

use crate::config;
use crate::model::{BrowserMsg, IngestMsg};
use anyhow::{Context, Result};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rust_embed::Embed;
use state::Board;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

#[derive(Embed)]
#[folder = "web/"]
struct Assets;

#[derive(Clone)]
struct AppState {
    board: Arc<Board>,
    token: Arc<str>,
    port: u16,
}

pub async fn serve(port: u16) -> Result<()> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                anyhow::anyhow!(
                    "el puerto {port} ya está en uso en 127.0.0.1 (¿otro `argos-board serve`?). Usa --port para elegir otro."
                )
            } else {
                anyhow::Error::new(e).context(format!("no se pudo escuchar en 127.0.0.1:{port}"))
            }
        })?;
    let port = listener.local_addr()?.port();
    let token = config::create_token().context("creando el token de ingesta")?;

    let board = Arc::new(Board::new());
    let sweeper = board.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(15));
        loop {
            tick.tick().await;
            sweeper.sweep(state::EXPIRY);
        }
    });

    let app = router(AppState {
        board,
        token: token.into(),
        port,
    });
    eprintln!("argos-board escuchando en http://localhost:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/agents", get(api_agents))
        .route("/ws", get(browser_ws))
        .route("/ingest", get(ingest_ws))
        .fallback(static_file)
        .layer(middleware::from_fn_with_state(state.clone(), check_host))
        .with_state(state)
}

fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn host_allowed(host: &str, port: u16) -> bool {
    host == format!("localhost:{port}") || host == format!("127.0.0.1:{port}")
}

fn origin_allowed(origin: &str, port: u16) -> bool {
    origin
        .strip_prefix("http://")
        .is_some_and(|h| host_allowed(h, port))
}

/// Rechaza cualquier petición cuyo `Host` no sea localhost:<port> (DNS rebinding)
/// y cualquier `Origin` ajeno (páginas externas).
async fn check_host(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    if !header_str(headers, header::HOST).is_some_and(|h| host_allowed(h, st.port)) {
        return (StatusCode::FORBIDDEN, "host no permitido").into_response();
    }
    if let Some(origin) = header_str(headers, header::ORIGIN)
        && !origin_allowed(origin, st.port)
    {
        return (StatusCode::FORBIDDEN, "origin no permitido").into_response();
    }
    next.run(req).await
}

async fn api_agents(State(st): State<AppState>) -> impl IntoResponse {
    Json(st.board.snapshot())
}

async fn browser_ws(
    State(st): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Los navegadores siempre mandan Origin en WebSocket; check_host ya validó su valor.
    if header_str(&headers, header::ORIGIN).is_none() {
        return (StatusCode::FORBIDDEN, "falta Origin").into_response();
    }
    ws.on_upgrade(move |socket| browser_session(socket, st.board))
}

async fn browser_session(mut socket: WebSocket, board: Arc<Board>) {
    let (agents, mut rx) = board.subscribe();
    if send_json(&mut socket, &BrowserMsg::Snapshot { agents })
        .await
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            ev = rx.recv() => {
                let msg = match ev {
                    Ok(m) => m,
                    // Si el navegador se quedó atrás, se le reenvía el estado completo.
                    Err(RecvError::Lagged(_)) => BrowserMsg::Snapshot { agents: board.snapshot() },
                    Err(RecvError::Closed) => return,
                };
                if send_json(&mut socket, &msg).await.is_err() {
                    return;
                }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => {}
            },
        }
    }
}

async fn send_json(socket: &mut WebSocket, msg: &BrowserMsg) -> Result<(), axum::Error> {
    let text = serde_json::to_string(msg).expect("BrowserMsg serializable");
    socket.send(Message::Text(text.into())).await
}

fn token_ok(headers: &HeaderMap, token: &str) -> bool {
    let Some(given) =
        header_str(headers, header::AUTHORIZATION).and_then(|v| v.strip_prefix("Bearer "))
    else {
        return false;
    };
    // Comparación en tiempo constante respecto al contenido.
    given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

async fn ingest_ws(
    State(st): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // El wrapper no es un navegador: un Origin aquí es sospechoso.
    if headers.contains_key(header::ORIGIN) || !token_ok(&headers, &st.token) {
        return (StatusCode::UNAUTHORIZED, "token inválido").into_response();
    }
    ws.on_upgrade(move |socket| ingest_session(socket, st.board))
}

async fn ingest_session(mut socket: WebSocket, board: Arc<Board>) {
    let conn = board.new_conn();
    let mut agent = None;
    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        match serde_json::from_str::<IngestMsg>(&text) {
            Ok(m) => {
                if agent.is_none() && !matches!(m, IngestMsg::Hello { .. }) {
                    tracing::warn!("mensaje de ingesta antes de hello; se ignora");
                    continue;
                }
                if let Some(id) = board.apply(conn, agent, m) {
                    agent = Some(id);
                }
            }
            Err(e) => tracing::warn!("mensaje de ingesta inválido: {e}"),
        }
    }
    if let Some(id) = agent {
        board.connection_closed(conn, id);
    }
}

async fn static_file(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Assets::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref().to_string()),
                    (header::CACHE_CONTROL, "no-cache".to_string()),
                ],
                file.data.into_owned(),
            )
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, "no encontrado").into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_and_origin_rules() {
        assert!(host_allowed("localhost:8787", 8787));
        assert!(host_allowed("127.0.0.1:8787", 8787));
        assert!(!host_allowed("evil.example:8787", 8787));
        assert!(!host_allowed("localhost:9999", 8787));
        assert!(origin_allowed("http://localhost:8787", 8787));
        assert!(!origin_allowed("https://evil.example", 8787));
        assert!(!origin_allowed("http://localhost.evil.example:8787", 8787));
    }

    #[test]
    fn token_check() {
        let mut h = HeaderMap::new();
        assert!(!token_ok(&h, "abc"));
        h.insert(header::AUTHORIZATION, "Bearer abd".parse().unwrap());
        assert!(!token_ok(&h, "abc"));
        h.insert(header::AUTHORIZATION, "Bearer abc".parse().unwrap());
        assert!(token_ok(&h, "abc"));
    }
}
