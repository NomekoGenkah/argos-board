//! Integración: servidor real + wrapper real con un CLI falso.

use futures_util::StreamExt;
use serde_json::Value;
use std::io::Write;
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

const BIN: &str = env!("CARGO_BIN_EXE_argos-board");

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start_server(cfg: &Path, port: u16) -> Server {
    let child = Command::new(BIN)
        .args(["serve", "--port", &port.to_string()])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg)
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while std::net::TcpStream::connect(("127.0.0.1", port)).is_err() || !cfg.join("token").exists()
    {
        assert!(Instant::now() < deadline, "el servidor no arrancó");
        std::thread::sleep(Duration::from_millis(50));
    }
    Server(child)
}

/// GET mínimo por HTTP/1.1 (evita añadir un cliente HTTP como dependencia).
fn http_get(port: u16, path: &str, host: &str) -> (u16, String) {
    use std::io::Read;
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(
        s,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).unwrap();
    let status = buf.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = buf
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    (status, body)
}

fn agents(port: u16) -> Vec<Value> {
    let (status, body) = http_get(port, "/api/agents", &format!("127.0.0.1:{port}"));
    assert_eq!(status, 200, "{body}");
    serde_json::from_str(&body).unwrap()
}

fn wait_for(port: u16, what: &str, pred: impl Fn(&[Value]) -> bool) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let a = agents(port);
        if pred(&a) {
            return a;
        }
        assert!(
            Instant::now() < deadline,
            "timeout esperando {what}: {a:#?}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn wrapper_reports_to_server_and_propagates_exit_code() {
    let cfg = tempfile::tempdir().unwrap();
    let dumps = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server(cfg.path(), port);

    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake_agent.sh");
    let mut wrapper = Command::new(BIN)
        .args([
            "run",
            "--name",
            "fake@test",
            "--port",
            &port.to_string(),
            "--dump-screens",
        ])
        .arg(dumps.path())
        .arg("--")
        .arg(&script)
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .env("FAKE_AGENT_LINGER", "0.5")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    // Aparece la tarjeta con el prompt en pantalla y el secreto redactado.
    let a = wait_for(port, "prompt de aprobación", |a| {
        a.iter().any(|x| {
            x["last_lines"]
                .as_array()
                .is_some_and(|l| l.iter().any(|s| s.as_str().unwrap().contains("(y/n)")))
        })
    });
    let agent = &a[0];
    assert_eq!(agent["name"], "fake@test");
    assert_eq!(agent["kind"], "generic");
    let lines = serde_json::to_string(&agent["last_lines"]).unwrap();
    assert!(lines.contains("OPENAI_API_KEY=[REDACTED]"), "{lines}");
    assert!(!lines.contains("no-deberia-verse"), "{lines}");

    // Con salida reciente → working; sin salida → idle (ventana de actividad + histéresis).
    // El estado inicial también es idle, así que primero hay que ver working.
    wait_for(port, "working", |a| a[0]["state"] == "working");
    wait_for(port, "idle", |a| a[0]["state"] == "idle");

    // Respondemos al "prompt" a través del PTY.
    wrapper.stdin.as_mut().unwrap().write_all(b"y\n").unwrap();
    let out = wrapper.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(3), "código de salida propagado");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("respuesta: y"),
        "salida transparente: {stdout}"
    );

    wait_for(port, "exited", |a| a[0]["state"] == "exited");

    let dumped: Vec<_> = std::fs::read_dir(dumps.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert!(
        dumped
            .iter()
            .any(|f| f.to_string_lossy().ends_with("-idle.txt")),
        "{dumped:?}"
    );
    assert!(
        dumped
            .iter()
            .any(|f| f.to_string_lossy().ends_with("-exited.txt")),
        "{dumped:?}"
    );
}

#[test]
fn wrapper_works_without_server() {
    let cfg = tempfile::tempdir().unwrap();
    let out = Command::new(BIN)
        .args([
            "run",
            "--port",
            &free_port().to_string(),
            "--",
            "sh",
            "-c",
            "echo hola; exit 7",
        ])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(7));
    assert!(String::from_utf8_lossy(&out.stdout).contains("hola"));
    assert!(
        out.stderr.is_empty(),
        "no debe ensuciar la terminal: {:?}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn security_checks() {
    let cfg = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server(cfg.path(), port);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(cfg.path().join("token"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // Host ajeno (DNS rebinding) → 403.
    assert_eq!(http_get(port, "/api/agents", "evil.example").0, 403);
    assert_eq!(http_get(port, "/", &format!("localhost:{port}")).0, 200);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        // Ingesta sin token → rechazada.
        let req = format!("ws://127.0.0.1:{port}/ingest")
            .into_client_request()
            .unwrap();
        assert!(tokio_tungstenite::connect_async(req).await.is_err());

        // WebSocket del navegador con Origin externo → rechazado.
        let mut req = format!("ws://127.0.0.1:{port}/ws")
            .into_client_request()
            .unwrap();
        req.headers_mut()
            .insert("origin", "https://evil.example".parse().unwrap());
        assert!(tokio_tungstenite::connect_async(req).await.is_err());

        // Con Origin local → recibe el snapshot inicial.
        let mut req = format!("ws://127.0.0.1:{port}/ws")
            .into_client_request()
            .unwrap();
        req.headers_mut().insert(
            "origin",
            format!("http://localhost:{port}").parse().unwrap(),
        );
        let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let first = ws.next().await.unwrap().unwrap();
        let v: Value = serde_json::from_str(first.to_text().unwrap()).unwrap();
        assert_eq!(v["type"], "snapshot");
    });

    // Puerto ocupado → error claro.
    let out = Command::new(BIN)
        .args(["serve", "--port", &port.to_string()])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("ya está en uso"));
}

/// Un wrapper (simulado) reporta `waiting_input` y el servidor lo publica tal cual.
#[test]
fn ingest_waiting_input_state() {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message;

    let cfg = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server(cfg.path(), port);
    let token = std::fs::read_to_string(cfg.path().join("token")).unwrap();

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let mut req = format!("ws://127.0.0.1:{port}/ingest").into_client_request().unwrap();
        req.headers_mut()
            .insert("authorization", format!("Bearer {}", token.trim()).parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let now = "2026-10-11T00:00:00Z";
        for msg in [
            serde_json::json!({"type": "hello", "id": "7f1d6a3e-1111-4222-8333-944455556666", "name": "falso@pregunta",
                "kind": "claude", "project": "/tmp/p", "pid": 1, "started_at": now, "git_branch": "main"}),
            serde_json::json!({"type": "state", "state": "waiting_input", "since": now}),
        ] {
            ws.send(Message::text(msg.to_string())).await.unwrap();
        }
        // El navegador también recibe el estado por /ws.
        let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
        req.headers_mut()
            .insert("origin", format!("http://localhost:{port}").parse().unwrap());
        let (mut browser, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let snap: Value = serde_json::from_str(browser.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
            let agents = snap["agents"].as_array().cloned().unwrap_or_else(|| vec![snap["agent"].clone()]);
            if agents.iter().any(|a| a["state"] == "waiting_input") {
                break;
            }
            assert!(Instant::now() < deadline, "no llegó waiting_input al navegador");
        }
        let a = wait_for(port, "waiting_input en la API", |a| {
            a.iter().any(|x| x["state"] == "waiting_input")
        });
        assert_eq!(a[0]["name"], "falso@pregunta");
        drop(ws);
    });

    // Sin `exit`, cerrar la ingesta deja al agente desconectado.
    wait_for(port, "disconnected", |a| a[0]["state"] == "disconnected");
}
