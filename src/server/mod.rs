//! `argos-board serve`: HTTP + WebSocket en 127.0.0.1.

pub mod launch;
pub mod state;
pub mod usage;
pub mod voice;

use crate::VERSION;
use crate::config;
use crate::devices::{self, Pairing, Store, same_secret};
use crate::model::{BrowserMsg, FromBrowser, IngestMsg, WrapperCmd};
use anyhow::{Context, Result, bail};
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use launch::Launcher;
use rust_embed::Embed;
use state::Board;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use voice::VoiceHub;

#[derive(Embed)]
#[folder = "web/"]
struct Assets;

#[derive(Clone)]
struct AppState {
    board: Arc<Board>,
    token: Arc<str>,
    /// Autoriza a la página a escribir en los agentes (va en el enlace de `serve`).
    control: Arc<str>,
    launcher: Arc<Launcher>,
    /// Valores de `Host` aceptados (con puerto, en minúsculas).
    hosts: Arc<Vec<String>>,
    pairing: Arc<Pairing>,
    voice: Arc<VoiceHub>,
    usage: Arc<usage::UsageHub>,
}

/// Sin dictados, el `agy` que transcribe se cierra pasado este tiempo.
const VOICE_IDLE: Duration = Duration::from_secs(20 * 60);

/// Máximo de entradas por segundo de una misma página.
const INPUT_RATE: u32 = 30;

/// IP privada: la de una red doméstica, un túnel WireGuard/Tailscale o un enlace local.
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_private() || v4.is_link_local() || (o[0] == 100 && (o[1] & 0b1100_0000) == 64)
        }
        IpAddr::V6(v6) => v6.is_unique_local() || v6.is_unicast_link_local(),
    }
}

fn is_local_ip(ip: IpAddr) -> bool {
    ip.to_canonical().is_loopback()
}

/// `ip:puerto` como lo escribe un navegador en `Host` (IPv6 entre corchetes).
fn host_port(ip: IpAddr, port: u16) -> String {
    match ip {
        IpAddr::V4(_) => format!("{ip}:{port}"),
        IpAddr::V6(_) => format!("[{ip}]:{port}"),
    }
}

/// Comprueba las IPs de `--bind`: solo direcciones concretas de una red privada.
fn validate_binds(binds: &[IpAddr]) -> Result<Vec<IpAddr>> {
    let mut out: Vec<IpAddr> = Vec::new();
    for &ip in binds {
        if ip.is_unspecified() {
            bail!(
                "--bind {ip} escucharía en todas las interfaces; usa la IP concreta de la red (p. ej. la de WireGuard)"
            );
        }
        if !is_local_ip(ip) && !is_private_ip(ip) {
            bail!(
                "--bind {ip} no es una IP privada: argos-board no se expone fuera de la red local"
            );
        }
        if !is_local_ip(ip) && !out.contains(&ip) {
            out.push(ip);
        }
    }
    Ok(out)
}

pub async fn serve(
    port: u16,
    local_only: bool,
    binds: Vec<IpAddr>,
    allow_hosts: Vec<String>,
) -> Result<()> {
    // Dónde ofrecer el tablero además de 127.0.0.1: las IPs de --bind o, por defecto, las
    // redes privadas de esta máquina. Con --bind, un fallo es un error; con la detección
    // automática, una dirección que no se pueda abrir solo se omite con un aviso.
    let explicit = !binds.is_empty();
    let candidates: Vec<(IpAddr, String)> = if local_only {
        Vec::new()
    } else if explicit {
        validate_binds(&binds)?
            .into_iter()
            .map(|ip| (ip, "--bind".to_string()))
            .collect()
    } else {
        crate::netif::private_interfaces()
            .into_iter()
            .map(|(name, ip)| (ip, name))
            .collect()
    };
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
    let mut listeners = vec![listener];
    let mut extra: Vec<(IpAddr, String)> = Vec::new();
    for (ip, name) in candidates {
        match tokio::net::TcpListener::bind((ip, port)).await {
            Ok(l) => {
                listeners.push(l);
                extra.push((ip, name));
            }
            Err(e) if explicit => {
                return Err(e)
                    .with_context(|| format!("no se pudo escuchar en {}", host_port(ip, port)));
            }
            Err(e) => eprintln!(
                "argos-board: no se pudo escuchar en {} ({name}): {e}",
                host_port(ip, port)
            ),
        }
    }
    let token = config::create_token().context("creando el token de ingesta")?;
    let control = config::control_token().context("creando el token de control")?;

    let mut hosts = vec![format!("localhost:{port}"), format!("127.0.0.1:{port}")];
    hosts.extend(extra.iter().map(|(ip, _)| host_port(*ip, port)));
    hosts.extend(
        allow_hosts
            .iter()
            .map(|h| format!("{}:{port}", h.trim().to_lowercase())),
    );
    let store = Store::open().context("abriendo los dispositivos emparejados")?;

    let (launcher, warnings) = Launcher::new(port);
    for w in warnings {
        eprintln!("argos-board: {w}");
    }
    let launcher = Arc::new(launcher);
    let board = Arc::new(Board::new());
    let (sweeper, reaper) = (board.clone(), launcher.clone());
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(15));
        loop {
            tick.tick().await;
            sweeper.sweep(state::EXPIRY);
            reaper.reap();
        }
    });

    let pairing = Arc::new(Pairing::new(store.clone()));
    let voice = VoiceHub::new();
    {
        let voice = voice.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                voice.reap_idle(VOICE_IDLE);
            }
        });
    }
    let app = router(AppState {
        board,
        token: token.into(),
        control: control.clone().into(),
        launcher,
        hosts: Arc::new(hosts),
        pairing,
        voice,
        usage: Arc::new(usage::UsageHub::new(
            crate::config::config_dir()?.join("usage-probe"),
        )),
    });
    eprintln!("argos-board {VERSION} escuchando en http://localhost:{port}");
    // El enlace con el token y el código van al usuario por la terminal, nunca a un log.
    eprintln!(
        "Para escribir en los agentes desde la página, abre: http://localhost:{port}/#k={control}"
    );
    announce_network(&extra, local_only, port, &store);
    let mut servers = tokio::task::JoinSet::new();
    for l in listeners {
        let make = app
            .clone()
            .into_make_service_with_connect_info::<SocketAddr>();
        servers.spawn(async move { axum::serve(l, make).await });
    }
    if let Some(res) = servers.join_next().await {
        res??;
    }
    Ok(())
}

/// Dice desde dónde conectarse con el celular y, si aún no hay ningún dispositivo
/// emparejado, genera y muestra el código para emparejar el primero.
fn announce_network(extra: &[(IpAddr, String)], local_only: bool, port: u16, store: &Store) {
    if local_only {
        eprintln!("Modo --local-only: el tablero solo se ofrece en esta máquina.");
        return;
    }
    if extra.is_empty() {
        eprintln!(
            "No encontré una red privada en esta máquina: el tablero solo se ofrece aquí. Si tu red \
             tiene otra dirección, indícala con --bind <IP>."
        );
        return;
    }
    eprintln!();
    eprintln!("Desde el celular u otro dispositivo de la red, abre:");
    for (ip, name) in extra {
        eprintln!("    http://{}/   ({name})", host_port(*ip, port));
    }
    match store.list() {
        Ok(devices) if devices.is_empty() => match store.create_code(Utc::now()) {
            Ok((code, _)) => {
                eprintln!();
                eprintln!("Código de emparejamiento:  {code}");
                eprintln!(
                    "    (un solo uso, caduca en {} minutos; ingrésalo en esa página)",
                    devices::CODE_TTL_MINUTES
                );
            }
            Err(e) => eprintln!("argos-board: no se pudo crear el código de emparejamiento: {e:#}"),
        },
        Ok(devices) => eprintln!(
            "{} dispositivo(s) emparejado(s). Para sumar otro: `argos-board pair`.",
            devices.len()
        ),
        Err(e) => eprintln!("argos-board: no se pudieron leer los dispositivos emparejados: {e:#}"),
    }
    eprintln!();
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/agents", get(api_agents))
        .route(
            "/api/pair",
            post(api_pair).layer(DefaultBodyLimit::max(4 * 1024)),
        )
        .route(
            "/api/agents/{id}/upload",
            post(api_upload).layer(DefaultBodyLimit::max(25 * 1024 * 1024)),
        )
        .route("/ws", get(browser_ws))
        .route("/ingest", get(ingest_ws))
        .fallback(static_file)
        .layer(middleware::from_fn_with_state(state.clone(), check_host))
        .with_state(state)
}

fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn host_allowed(host: &str, hosts: &[String]) -> bool {
    let host = host.to_lowercase();
    hosts.contains(&host)
}

fn origin_allowed(origin: &str, hosts: &[String]) -> bool {
    origin
        .strip_prefix("http://")
        .is_some_and(|h| host_allowed(h, hosts))
}

fn peer_ip(req: &Request) -> Option<IpAddr> {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip())
}

/// Rechaza (a) pares que no sean de la propia máquina ni de una red privada,
/// (b) cualquier petición cuyo `Host` no sea uno de los esperados (DNS rebinding)
/// y (c) cualquier `Origin` ajeno (páginas externas).
async fn check_host(State(st): State<AppState>, req: Request, next: Next) -> Response {
    // Sin dirección de par no se puede juzgar: se rechaza.
    if !peer_ip(&req).is_some_and(|ip| is_local_ip(ip) || is_private_ip(ip)) {
        return (StatusCode::FORBIDDEN, "origen de red no permitido").into_response();
    }
    let headers = req.headers();
    if !header_str(headers, header::HOST).is_some_and(|h| host_allowed(h, &st.hosts)) {
        return (StatusCode::FORBIDDEN, "host no permitido").into_response();
    }
    if let Some(origin) = header_str(headers, header::ORIGIN)
        && !origin_allowed(origin, &st.hosts)
    {
        return (StatusCode::FORBIDDEN, "origin no permitido").into_response();
    }
    next.run(req).await
}

/// El token de dispositivo de `Authorization: Bearer …`, si es válido.
fn bearer_device(headers: &HeaderMap, store: &Store) -> Option<devices::Device> {
    let given = header_str(headers, header::AUTHORIZATION)?.strip_prefix("Bearer ")?;
    store.authenticate(given, Utc::now())
}

async fn api_agents(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    // Desde la propia máquina se lee sin credencial; desde la red, con un dispositivo emparejado.
    if !is_local_ip(peer.ip()) && bearer_device(&headers, st.pairing.store()).is_none() {
        return (StatusCode::UNAUTHORIZED, "dispositivo no emparejado").into_response();
    }
    Json(st.board.snapshot()).into_response()
}

#[derive(serde::Deserialize)]
struct PairBody {
    code: String,
    #[serde(default)]
    name: Option<String>,
}

/// Canjea un código de `argos-board pair` por el token del dispositivo.
async fn api_pair(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<PairBody>,
) -> Response {
    let label = body.name.as_deref().unwrap_or("dispositivo");
    let result = st
        .pairing
        .try_pair(&body.code, label, Utc::now(), std::time::Instant::now());
    let no_store = [(header::CACHE_CONTROL, "no-store")];
    match result {
        Ok(d) => {
            tracing::info!(device = %d.id, name = %d.name, peer = %peer.ip(), "dispositivo emparejado");
            (
                no_store,
                Json(serde_json::json!({ "token": d.token, "id": d.id, "name": d.name })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::warn!(peer = %peer.ip(), error = ?e, "emparejamiento fallido");
            let status = match e {
                devices::PairError::TooMany => StatusCode::TOO_MANY_REQUESTS,
                devices::PairError::Storage => StatusCode::INTERNAL_SERVER_ERROR,
                _ => StatusCode::FORBIDDEN,
            };
            (
                status,
                no_store,
                Json(serde_json::json!({ "error": e.message() })),
            )
                .into_response()
        }
    }
}

fn authorized_for_control(
    headers: &HeaderMap,
    peer: &SocketAddr,
    control: &str,
    devices: &Store,
) -> bool {
    let token = header_str(headers, header::AUTHORIZATION)
        .and_then(|h| h.strip_prefix("Bearer "))
        .or_else(|| header_str(headers, header::HeaderName::from_static("x-argos-token")));
    if let Some(t) = token {
        if is_local_ip(peer.ip()) && same_secret(t, control) {
            return true;
        }
        if devices.authenticate(t, Utc::now()).is_some() {
            return true;
        }
    }
    false
}

#[derive(serde::Deserialize)]
struct UploadQuery {
    #[serde(default)]
    name: Option<String>,
}

fn sanitize_upload_filename(raw: &str) -> String {
    let base = std::path::Path::new(raw)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload");
    let clean: String = base
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    let clean = clean.trim_matches('.').to_string();
    if clean.is_empty() {
        "upload".into()
    } else {
        clean.chars().take(80).collect()
    }
}

fn is_image_extension(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp"
    )
}

/// Sube un archivo al directorio `<proyecto>/.argos/uploads/` del agente.
async fn api_upload(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Query(query): Query<UploadQuery>,
    body: Bytes,
) -> Response {
    if !authorized_for_control(&headers, &peer, &st.control, st.pairing.store()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "ok": false, "error": "esta acción requiere permiso de escritura" })),
        )
            .into_response();
    }
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": "el archivo está vacío" })),
        )
            .into_response();
    }
    let project_path = match st.board.upload_target(id) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": e })),
            )
                .into_response();
        }
    };

    let raw_name = query.name.as_deref().unwrap_or("archivo.dat");
    let clean_name = sanitize_upload_filename(raw_name);
    let ext = std::path::Path::new(&clean_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let is_image = is_image_extension(ext);

    let uploads_dir = project_path.join(".argos").join("uploads");
    let gitignore_path = project_path.join(".argos").join(".gitignore");
    let file_path = uploads_dir.join(&clean_name);

    let write_res = tokio::task::spawn_blocking(move || -> Result<(), std::io::Error> {
        std::fs::create_dir_all(&uploads_dir)?;
        if !gitignore_path.exists() {
            let _ = std::fs::write(&gitignore_path, "*\n!.gitignore\n");
        }
        std::fs::write(&file_path, &body)?;
        Ok(())
    })
    .await;

    match write_res {
        Ok(Ok(())) => {
            let rel = format!(".argos/uploads/{clean_name}");
            tracing::info!(agent = %id, file = %rel, "archivo subido al proyecto");
            Json(serde_json::json!({
                "ok": true,
                "filename": clean_name,
                "relative_path": rel,
                "is_image": is_image,
            }))
            .into_response()
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": "no se pudo guardar el archivo en el proyecto" })),
        )
            .into_response(),
    }
}

async fn browser_ws(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Los navegadores siempre mandan Origin en WebSocket; check_host ya validó su valor.
    if header_str(&headers, header::ORIGIN).is_none() {
        return (StatusCode::FORBIDDEN, "falta Origin").into_response();
    }
    let access = Access {
        local: is_local_ip(peer.ip()),
        control: st.control,
        devices: st.pairing.store().clone(),
    };
    ws.max_message_size(512 * 1024).on_upgrade(move |socket| {
        browser_session(socket, st.board, access, st.launcher, st.voice, st.usage)
    })
}

/// Ventana de un segundo para limitar el ritmo de entradas.
struct RateLimit {
    window: std::time::Instant,
    count: u32,
}

impl RateLimit {
    fn allow(&mut self) -> bool {
        if self.window.elapsed() >= Duration::from_secs(1) {
            self.window = std::time::Instant::now();
            self.count = 0;
        }
        self.count += 1;
        self.count <= INPUT_RATE
    }
}

const NO_PERMISSION: &str =
    "esta página no tiene permiso para escribir (abre el enlace que imprime `argos-board serve`)";

/// Atiende un mensaje del navegador. Devuelve las respuestas.
/// Lo que el servidor le presta a cada sesión de página.
struct Hubs<'a> {
    board: &'a Arc<Board>,
    launcher: &'a Arc<Launcher>,
    usage: &'a Arc<usage::UsageHub>,
}

async fn handle_browser_msg(
    hubs: Hubs<'_>,
    access: &Access,
    session: &mut Session,
    rate: &mut RateLimit,
    voice: &VoiceCtx,
    text: &str,
) -> Vec<BrowserMsg> {
    let Hubs {
        board,
        launcher,
        usage,
    } = hubs;
    let authorized = &mut session.authorized;
    let msg = match serde_json::from_str::<FromBrowser>(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("mensaje del navegador inválido: {e}");
            return Vec::new();
        }
    };
    let action = |rid, result: Result<Option<String>, String>| BrowserMsg::ActionResult {
        rid,
        ok: result.is_ok(),
        name: result.as_ref().ok().cloned().flatten(),
        error: result.err(),
    };
    match msg {
        FromBrowser::Auth { token } => {
            // El token de control es el del enlace de `serve`: solo vale desde la propia
            // máquina. Desde la red hace falta un dispositivo emparejado (revocable).
            let device = access.devices.authenticate(&token, Utc::now());
            *authorized =
                device.is_some() || (access.local && same_secret(&token, &access.control));
            session.device = device.map(|d| d.id);
            if !*authorized {
                tracing::warn!(local = access.local, "credencial inválida desde la página");
                return vec![BrowserMsg::AuthResult { ok: false }];
            }
            let info = launcher.info();
            vec![
                BrowserMsg::AuthResult { ok: true },
                BrowserMsg::LaunchInfo { info },
                BrowserMsg::VoiceInfo {
                    available: voice.hub.available(),
                },
            ]
        }
        FromBrowser::Usage { rid, refresh } => {
            // Lo ve quien ve los agentes; actualizar a la fuerza, solo quien puede escribir en ellos.
            if !session.can_read {
                return Vec::new();
            }
            let report = usage.report(refresh && *authorized).await;
            vec![BrowserMsg::Usage {
                rid,
                available: usage.available(),
                report,
            }]
        }
        FromBrowser::ListDirs { rid, path } => {
            let result = if *authorized {
                let l = launcher.clone();
                tokio::task::spawn_blocking(move || {
                    l.list_dirs(path.as_deref()).map_err(str::to_string)
                })
                .await
                .unwrap_or_else(|_| Err("error interno".into()))
            } else {
                Err(NO_PERMISSION.into())
            };
            vec![match result {
                Ok(l) => BrowserMsg::Dirs {
                    rid,
                    ok: true,
                    path: l.path,
                    parent: l.parent,
                    dirs: l.dirs,
                    error: None,
                },
                Err(e) => BrowserMsg::Dirs {
                    rid,
                    ok: false,
                    path: String::new(),
                    parent: None,
                    dirs: Vec::new(),
                    error: Some(e),
                },
            }]
        }
        FromBrowser::Launch {
            rid,
            kind,
            dir,
            name,
        } => {
            let result = if !*authorized {
                Err(NO_PERMISSION.to_string())
            } else if !rate.allow() {
                Err("demasiadas peticiones seguidas; espera un momento".to_string())
            } else {
                let l = launcher.clone();
                tokio::task::spawn_blocking(move || l.launch(kind, &dir, name.as_deref()))
                    .await
                    .unwrap_or_else(|_| Err("error interno".into()))
                    .map(Some)
            };
            vec![action(rid, result)]
        }
        FromBrowser::Stop { rid, id } => {
            let result = if !*authorized {
                Err(NO_PERMISSION.to_string())
            } else {
                match board.launch_of(id) {
                    None => Err("ese agente no se lanzó desde la página".to_string()),
                    Some((_, crate::model::AgentState::Exited)) => {
                        Err("el agente ya terminó".to_string())
                    }
                    Some((launch, _)) => {
                        let l = launcher.clone();
                        tracing::info!(agent = %id, "detener agente desde la página");
                        tokio::task::spawn_blocking(move || l.stop(&launch))
                            .await
                            .unwrap_or_else(|_| Err("error interno".into()))
                            .map(|_| None)
                    }
                }
            };
            vec![action(rid, result)]
        }
        FromBrowser::Input { id, rid, input } => {
            let result = if !*authorized {
                Err(NO_PERMISSION)
            } else {
                // Se valida antes de contar: un mensaje inválido no gasta el cupo.
                input.sanitized().and_then(|input| {
                    if !rate.allow() {
                        return Err("demasiadas entradas seguidas; espera un momento");
                    }
                    let (kind, bytes) = input.describe();
                    // Nunca el contenido: puede tener secretos.
                    tracing::info!(agent = %id, kind, bytes, "entrada desde la web");
                    board.send_input(id, input)
                })
            };
            vec![BrowserMsg::InputResult {
                rid,
                ok: result.is_ok(),
                error: result.err().map(str::to_string),
            }]
        }
        FromBrowser::VoicePrepare => {
            if *authorized {
                voice.hub.prepare();
            }
            Vec::new()
        }
        FromBrowser::VoiceStart => {
            let result = if !*authorized {
                Err(NO_PERMISSION.to_string())
            } else {
                voice.hub.start(voice.owner, voice.events.clone())
            };
            match result {
                Ok(()) => {
                    session.dictating = true;
                    Vec::new()
                }
                Err(message) => vec![BrowserMsg::VoiceError { message }],
            }
        }
        FromBrowser::VoiceStop => {
            voice.hub.finish(voice.owner);
            Vec::new()
        }
        FromBrowser::VoiceCancel => {
            voice.hub.cancel(voice.owner);
            Vec::new()
        }
    }
}

/// Quién se conecta al `/ws`.
struct Access {
    /// La conexión viene de la propia máquina.
    local: bool,
    /// Token del enlace de `serve` (solo vale si `local`).
    control: Arc<str>,
    devices: Store,
}

/// Estado de una conexión del navegador.
#[derive(Default)]
struct Session {
    /// Puede escribir y lanzar agentes.
    authorized: bool,
    /// Puede ver los agentes: la propia máquina siempre; la red, tras autenticarse.
    can_read: bool,
    /// Dispositivo emparejado que se autenticó (si fue con uno).
    device: Option<String>,
    /// Pidió un dictado de voz (los mensajes binarios son su audio).
    dictating: bool,
}

/// Lo que una sesión necesita para dictar por voz.
struct VoiceCtx {
    hub: Arc<VoiceHub>,
    /// Identifica a esta sesión ante el concentrador de voz.
    owner: u64,
    /// Por aquí vuelven el estado y el texto del dictado.
    events: tokio::sync::mpsc::UnboundedSender<BrowserMsg>,
}

/// Al cerrarse la sesión, un dictado suyo en curso se descarta.
impl Drop for VoiceCtx {
    fn drop(&mut self) {
        self.hub.cancel(self.owner);
    }
}

/// Cada cuánto una sesión comprueba que su dispositivo no se haya revocado.
const DEVICE_CHECK: Duration = Duration::from_secs(5);

async fn browser_session(
    mut socket: WebSocket,
    board: Arc<Board>,
    access: Access,
    launcher: Arc<Launcher>,
    voice_hub: Arc<VoiceHub>,
    usage: Arc<usage::UsageHub>,
) {
    let (voice_tx, mut voice_rx) = tokio::sync::mpsc::unbounded_channel::<BrowserMsg>();
    let voice = VoiceCtx {
        owner: voice_hub.new_owner(),
        hub: voice_hub,
        events: voice_tx,
    };
    let mut session = Session {
        can_read: access.local,
        ..Session::default()
    };
    let mut rate = RateLimit {
        window: std::time::Instant::now(),
        count: 0,
    };
    let (agents, mut rx) = board.subscribe();
    let first = if session.can_read {
        BrowserMsg::Snapshot {
            agents,
            server_version: VERSION,
        }
    } else {
        // Desde la red no se muestra nada hasta autenticarse.
        BrowserMsg::AuthRequired
    };
    if send_json(&mut socket, &first).await.is_err() {
        return;
    }
    let mut check = tokio::time::interval(DEVICE_CHECK);
    loop {
        tokio::select! {
            ev = rx.recv() => {
                let msg = match ev {
                    Ok(m) => m,
                    // Si el navegador se quedó atrás, se le reenvía el estado completo.
                    Err(RecvError::Lagged(_)) => BrowserMsg::Snapshot { agents: board.snapshot(), server_version: VERSION },
                    Err(RecvError::Closed) => return,
                };
                if session.can_read && send_json(&mut socket, &msg).await.is_err() {
                    return;
                }
            }
            Some(msg) = voice_rx.recv() => {
                if send_json(&mut socket, &msg).await.is_err() {
                    return;
                }
            }
            _ = check.tick() => {
                // Revocado o caducado: se corta; al reconectar tendrá que emparejarse de nuevo.
                if let Some(id) = &session.device
                    && !access.devices.touch(id, Utc::now())
                {
                    return;
                }
            }
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(Message::Text(text))) => {
                    let replies = handle_browser_msg(Hubs { board: &board, launcher: &launcher, usage: &usage }, &access, &mut session, &mut rate, &voice, &text).await;
                    for reply in replies {
                        if send_json(&mut socket, &reply).await.is_err() {
                            return;
                        }
                    }
                    // Recién autenticado desde la red: ahora sí ve los agentes.
                    if session.authorized && !session.can_read {
                        session.can_read = true;
                        let snapshot = BrowserMsg::Snapshot { agents: board.snapshot(), server_version: VERSION };
                        if send_json(&mut socket, &snapshot).await.is_err() {
                            return;
                        }
                    }
                }
                Some(Ok(Message::Binary(data))) => {
                    // Audio del dictado (PCM de 16 kHz, 16 bits, mono).
                    if session.authorized && session.dictating && data.len() <= voice::MAX_AUDIO_MESSAGE {
                        voice.hub.push_audio(voice.owner, &data);
                    }
                }
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
    same_secret(given, token)
}

async fn ingest_ws(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Los wrappers corren en esta máquina: la ingesta no se ofrece a la red.
    if !is_local_ip(peer.ip()) {
        return (StatusCode::FORBIDDEN, "la ingesta es solo local").into_response();
    }
    // El wrapper no es un navegador: un Origin aquí es sospechoso.
    if headers.contains_key(header::ORIGIN) || !token_ok(&headers, &st.token) {
        return (StatusCode::UNAUTHORIZED, "token inválido").into_response();
    }
    ws.on_upgrade(move |socket| ingest_session(socket, st.board))
}

async fn ingest_session(mut socket: WebSocket, board: Arc<Board>) {
    let conn = board.new_conn();
    let mut agent = None;
    // Entrada desde la web para este wrapper.
    let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel::<WrapperCmd>();
    loop {
        let msg = tokio::select! {
            m = socket.recv() => match m {
                Some(Ok(m)) => m,
                _ => break,
            },
            Some(cmd) = input_rx.recv() => {
                let text = serde_json::to_string(&cmd).expect("WrapperCmd serializable");
                if socket.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
                continue;
            }
        };
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
                    board.attach_input(conn, id, input_tx.clone());
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
    let path = if path.is_empty() {
        "index.html"
    } else if path == "favicon.ico" && Assets::get("favicon.ico").is_none() {
        "favicon.svg"
    } else {
        path
    };
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
        let hosts: Vec<String> = [
            "localhost:8787",
            "127.0.0.1:8787",
            "10.8.0.1:8787",
            "[fd00::1]:8787",
        ]
        .map(String::from)
        .into();
        assert!(host_allowed("localhost:8787", &hosts));
        assert!(host_allowed("127.0.0.1:8787", &hosts));
        assert!(host_allowed("10.8.0.1:8787", &hosts));
        assert!(host_allowed("LOCALHOST:8787", &hosts));
        assert!(host_allowed("[fd00::1]:8787", &hosts));
        assert!(!host_allowed("evil.example:8787", &hosts));
        assert!(!host_allowed("10.8.0.2:8787", &hosts));
        assert!(!host_allowed("localhost:9999", &hosts));
        assert!(origin_allowed("http://localhost:8787", &hosts));
        assert!(origin_allowed("http://10.8.0.1:8787", &hosts));
        assert!(!origin_allowed("https://evil.example", &hosts));
        assert!(!origin_allowed(
            "http://localhost.evil.example:8787",
            &hosts
        ));
    }

    #[test]
    fn private_and_local_addresses() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        for private in [
            "10.8.0.1",
            "192.168.1.134",
            "172.16.5.4",
            "169.254.1.1",
            "100.64.0.9",
            "fd00::1",
            "fe80::1",
            "::ffff:192.168.1.5",
        ] {
            assert!(is_private_ip(ip(private)), "{private}");
        }
        for public in [
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "2001:4860:4860::8888",
            "::ffff:8.8.8.8",
        ] {
            assert!(!is_private_ip(ip(public)), "{public}");
        }
        assert!(
            is_local_ip(ip("127.0.0.1"))
                && is_local_ip(ip("::1"))
                && is_local_ip(ip("::ffff:127.0.0.1"))
        );
        assert!(!is_local_ip(ip("192.168.1.134")));
    }

    #[test]
    fn bind_addresses_are_validated() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        assert!(validate_binds(&[ip("0.0.0.0")]).is_err());
        assert!(validate_binds(&[ip("::")]).is_err());
        assert!(validate_binds(&[ip("8.8.8.8")]).is_err());
        // Loopback ya se escucha siempre; los duplicados se descartan.
        assert_eq!(
            validate_binds(&[ip("127.0.0.1"), ip("10.8.0.1"), ip("10.8.0.1")]).unwrap(),
            vec![ip("10.8.0.1")]
        );
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

    #[test]
    fn upload_filename_sanitizing_and_extension() {
        assert_eq!(sanitize_upload_filename("../secret/test.md"), "test.md");
        assert_eq!(sanitize_upload_filename("docs/plan.md"), "plan.md");
        assert_eq!(sanitize_upload_filename("screenshot.png"), "screenshot.png");
        assert_eq!(sanitize_upload_filename("..."), "upload");
        assert_eq!(sanitize_upload_filename(""), "upload");
        assert!(is_image_extension("png"));
        assert!(is_image_extension("JPG"));
        assert!(is_image_extension("webp"));
        assert!(!is_image_extension("md"));
        assert!(!is_image_extension("txt"));
    }
}
