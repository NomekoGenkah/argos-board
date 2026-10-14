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
        .args(["serve", "--local-only", "--port", &port.to_string()])
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

    // La rejilla exacta para dibujar la pantalla: ancho de la terminal, filas visibles y sin secretos.
    let grid = &agent["grid"];
    assert!(grid["cols"].as_u64().unwrap() > 0, "{grid}");
    assert_eq!(grid["alt"], false);
    let grid_lines = serde_json::to_string(&grid["lines"]).unwrap();
    assert!(grid_lines.contains("(y/n)"), "{grid_lines}");
    assert!(grid_lines.contains("OPENAI_API_KEY=[REDACTED]"), "{grid_lines}");
    assert!(!grid_lines.contains("no-deberia-verse"), "{grid_lines}");

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

/// Con un patrón de usuario, el wrapper detecta la pregunta del CLI falso
/// (`waiting_input`) aunque el perfil genérico no traiga patrones.
#[test]
fn wrapper_detects_waiting_input_with_user_profile() {
    let cfg = tempfile::tempdir().unwrap();
    std::fs::write(
        cfg.path().join("config.toml"),
        "[profiles.generic]\nwaiting_input = ['\\(y/n\\)']\n",
    )
    .unwrap();
    let port = free_port();
    let _server = start_server(cfg.path(), port);

    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake_agent.sh");
    let mut wrapper = Command::new(BIN)
        .args([
            "run",
            "--name",
            "fake@pregunta",
            "--port",
            &port.to_string(),
            "--",
        ])
        .arg(&script)
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    wait_for(port, "waiting_input", |a| {
        a.iter().any(|x| x["state"] == "waiting_input")
    });
    wrapper.stdin.as_mut().unwrap().write_all(b"y\n").unwrap();
    let out = wrapper.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(
        out.stderr.is_empty(),
        "sin avisos: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    wait_for(port, "exited", |a| a[0]["state"] == "exited");
}

/// Un config.toml roto avisa por stderr y el agente funciona igual.
#[test]
fn invalid_user_config_warns_and_runs() {
    let cfg = tempfile::tempdir().unwrap();
    std::fs::write(cfg.path().join("config.toml"), "esto no es [toml").unwrap();
    let out = Command::new(BIN)
        .args([
            "run",
            "--port",
            &free_port().to_string(),
            "--",
            "sh",
            "-c",
            "echo hola; exit 5",
        ])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(5));
    assert!(String::from_utf8_lossy(&out.stdout).contains("hola"));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("config.toml inválido"), "{err}");
}

/// #7: si el agente muere por una señal, el wrapper sale con 128 + N, como la shell.
#[test]
fn exit_code_for_signals_is_128_plus_n() {
    let cfg = tempfile::tempdir().unwrap();
    let out = Command::new(BIN)
        .args([
            "run",
            "--port",
            &free_port().to_string(),
            "--",
            "sh",
            "-c",
            "kill -TERM $$",
        ])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(143), "SIGTERM → 143");
}

/// #7: al cerrarse un stdin redirigido, el agente recibe EOF (no se queda colgado).
#[test]
fn closing_redirected_stdin_sends_eof() {
    let cfg = tempfile::tempdir().unwrap();
    let mut child = Command::new(BIN)
        .args([
            "run",
            "--port",
            &free_port().to_string(),
            "--",
            "sh",
            "-c",
            "cat >/dev/null; echo fin-de-entrada",
        ])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"hola\n").unwrap(); // se cierra al soltarlo
    let deadline = Instant::now() + Duration::from_secs(10);
    while child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline, "el agente no recibió EOF");
        std::thread::sleep(Duration::from_millis(50));
    }
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&out.stdout).contains("fin-de-entrada"));
}

/// #7: ARGOS_BOARD_LOG escribe el log del wrapper en un archivo, no en la terminal.
/// También comprueba que la API publica la versión del wrapper.
#[test]
fn wrapper_log_file_and_version() {
    let cfg = tempfile::tempdir().unwrap();
    let log = cfg.path().join("wrapper.log");
    let port = free_port();
    let _server = start_server(cfg.path(), port);
    let out = Command::new(BIN)
        .args([
            "run",
            "--name",
            "con-log",
            "--port",
            &port.to_string(),
            "--",
            "sh",
            "-c",
            "echo hola; sleep 1",
        ])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .env("ARGOS_BOARD_LOG", &log)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    assert!(
        out.stderr.is_empty(),
        "nada en la terminal: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(text.contains("conectado al servidor"), "{text}");
    assert!(text.contains("el agente terminó"), "{text}");

    let a = wait_for(port, "exited", |a| a.iter().any(|x| x["state"] == "exited"));
    let version = a[0]["version"].as_str().unwrap_or_default();
    assert!(
        version.starts_with(env!("CARGO_PKG_VERSION")),
        "versión: {version:?}"
    );
}

/// #17: con el token de control, la página escribe en el agente a través del
/// servidor y el wrapper; sin token, con uno falso o con `--no-input`, no.
#[test]
fn browser_input_reaches_the_agent() {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message;

    let cfg = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server(cfg.path(), port);
    let control = std::fs::read_to_string(cfg.path().join("control-token")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(cfg.path().join("control-token"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake_agent.sh");
    let spawn = |name: &str, extra: &[&str]| {
        Command::new(BIN)
            .args(["run", "--name", name, "--port", &port.to_string()])
            .args(extra)
            .arg("--")
            .arg(&script)
            .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
            .stdin(Stdio::piped()) // abierto y sin escribir: la respuesta llega desde la web
            .stdout(Stdio::piped())
            .spawn()
            .unwrap()
    };
    let mut wrapper = spawn("fake@web", &[]);
    // Se mantiene abierto: al cerrarse, el wrapper le mandaría EOF al agente.
    let _keep_stdin = wrapper.stdin.take();
    let mut locked = spawn("fake@local", &["--no-input"]);

    let ready = wait_for(port, "los dos prompts", |a| {
        a.len() == 2
            && a.iter().all(|x| {
                x["last_lines"]
                    .as_array()
                    .is_some_and(|l| l.iter().any(|s| s.as_str().unwrap().contains("(y/n)")))
            })
    });
    let id_of = |name: &str| {
        let a = ready.iter().find(|x| x["name"] == name).unwrap();
        (
            a["id"].as_str().unwrap().to_string(),
            a["accepts_input"].clone(),
        )
    };
    let (web_id, web_accepts) = id_of("fake@web");
    let (local_id, local_accepts) = id_of("fake@local");
    assert_eq!(web_accepts, true);
    assert_eq!(local_accepts, false);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let mut req = format!("ws://127.0.0.1:{port}/ws")
            .into_client_request()
            .unwrap();
        req.headers_mut().insert(
            "origin",
            format!("http://localhost:{port}").parse().unwrap(),
        );
        let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        // Manda un mensaje y espera la respuesta del tipo indicado (salteando
        // las actualizaciones de agentes).
        let mut ask = async |msg: Value, reply: &str| -> Value {
            ws.send(Message::text(msg.to_string())).await.unwrap();
            loop {
                let m = tokio::time::timeout(Duration::from_secs(5), ws.next())
                    .await
                    .expect("sin respuesta")
                    .unwrap()
                    .unwrap();
                let v: Value = serde_json::from_str(m.to_text().unwrap()).unwrap();
                if v["type"] == reply {
                    return v;
                }
            }
        };
        let send_y = |rid: u64, id: &str| {
            serde_json::json!({"type": "input", "id": id, "rid": rid,
                "input": {"type": "text", "text": "y", "submit": true}})
        };

        // Sin autorizar: rechazado.
        let r = ask(send_y(1, &web_id), "input_result").await;
        assert_eq!(r["ok"], false);
        assert!(r["error"].as_str().unwrap().contains("permiso"), "{r}");
        // Token falso: rechazado.
        let r = ask(
            serde_json::json!({"type": "auth", "token": "0".repeat(64)}),
            "auth_result",
        )
        .await;
        assert_eq!(r["ok"], false);
        assert_eq!(ask(send_y(2, &web_id), "input_result").await["ok"], false);
        // Token correcto.
        let r = ask(
            serde_json::json!({"type": "auth", "token": control.trim()}),
            "auth_result",
        )
        .await;
        assert_eq!(r["ok"], true);
        // Un agente con --no-input no acepta.
        let r = ask(send_y(3, &local_id), "input_result").await;
        assert_eq!(r["ok"], false);
        assert!(r["error"].as_str().unwrap().contains("no acepta"), "{r}");
        // Tecla fuera de la lista: el mensaje no se acepta (no hay respuesta ni escritura).
        // Y el texto con Enter llega al agente.
        let r = ask(send_y(4, &web_id), "input_result").await;
        assert_eq!(r["ok"], true, "{r}");
    });

    let out = wrapper.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(3));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("respuesta: y"), "{stdout}");

    // El de --no-input sigue esperando su respuesta local.
    locked.stdin.as_mut().unwrap().write_all(b"n\n").unwrap();
    let out = locked.wait_with_output().unwrap();
    assert!(String::from_utf8_lossy(&out.stdout).contains("respuesta: n"));
}

/// Servidor con un PATH y un entorno propios (para lanzar agentes falsos).
fn start_server_with(cfg: &Path, port: u16, path: &str, envs: &[(&str, &str)]) -> Server {
    let child = Command::new(BIN)
        .args(["serve", "--local-only", "--port", &port.to_string()])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg)
        .env("PATH", path)
        .envs(envs.iter().copied())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while std::net::TcpStream::connect(("127.0.0.1", port)).is_err()
        || !cfg.join("control-token").exists()
    {
        assert!(Instant::now() < deadline, "el servidor no arrancó");
        std::thread::sleep(Duration::from_millis(50));
    }
    Server(child)
}

/// #24: lanzar un agente desde la página (oculto y en tmux), escribirle y detenerlo.
fn launch_flow(use_tmux: bool) {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message;

    let cfg = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let roots = tempfile::tempdir().unwrap();
    let proyecto = roots.path().join("proyecto");
    std::fs::create_dir(&proyecto).unwrap();
    // Un `claude` falso: saluda y repite lo que le escriben.
    let fake = bin.path().join("claude");
    std::fs::write(
        &fake,
        "#!/bin/sh\necho \"claude falso en $(pwd)\"\nwhile read -r l; do echo \"dijiste: $l\"; done\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        cfg.path().join("config.toml"),
        format!("launch_roots = ['{}']\n", roots.path().display()),
    )
    .unwrap();
    // PATH mínimo: el `claude` falso y lo básico (sh, tmux); sin los agentes reales.
    let path = format!("{}:/usr/bin:/bin", bin.path().display());
    let port = free_port();
    let envs: &[(&str, &str)] = if use_tmux {
        &[]
    } else {
        &[("ARGOS_BOARD_NO_TMUX", "1")]
    };
    let _server = start_server_with(cfg.path(), port, &path, envs);
    let control = std::fs::read_to_string(cfg.path().join("control-token")).unwrap();
    let socket = format!("argos-board-{port}");

    let rt = tokio::runtime::Runtime::new().unwrap();
    let launched = rt.block_on(async {
        let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
        req.headers_mut()
            .insert("origin", format!("http://localhost:{port}").parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        let mut ask = async |msg: Value, reply: &str| -> Value {
            if !msg.is_null() {
                ws.send(Message::text(msg.to_string())).await.unwrap();
            }
            loop {
                let m = tokio::time::timeout(Duration::from_secs(5), ws.next())
                    .await
                    .expect("sin respuesta")
                    .unwrap()
                    .unwrap();
                let v: Value = serde_json::from_str(m.to_text().unwrap()).unwrap();
                if v["type"] == reply {
                    return v;
                }
            }
        };
        let launch = |rid: u64, kind: &str, dir: &str| {
            serde_json::json!({"type": "launch", "rid": rid, "kind": kind, "dir": dir})
        };
        let dir = proyecto.display().to_string();

        // Sin permiso: ni listar ni lanzar.
        let r = ask(launch(1, "claude", &dir), "action_result").await;
        assert_eq!(r["ok"], false);
        let r = ask(serde_json::json!({"type": "list_dirs", "rid": 2}), "dirs").await;
        assert_eq!(r["ok"], false);

        ask(serde_json::json!({"type": "auth", "token": control.trim()}), "auth_result").await;
        let info = ask(Value::Null, "launch_info").await;
        assert_eq!(info["info"]["kinds"], serde_json::json!(["claude"]), "{info}");
        assert_eq!(info["info"]["tmux"], use_tmux);

        let r = ask(serde_json::json!({"type": "list_dirs", "rid": 3}), "dirs").await;
        assert_eq!(r["dirs"], serde_json::json!(["proyecto"]), "{r}");
        // Fuera de las raíces, un tipo que no se lanza o no instalado: rechazado.
        let r = ask(launch(4, "claude", "/"), "action_result").await;
        assert!(r["error"].as_str().unwrap().contains("fuera"), "{r}");
        assert_eq!(ask(launch(5, "generic", &dir), "action_result").await["ok"], false);
        assert_eq!(ask(launch(6, "agy", &dir), "action_result").await["ok"], false);

        let r = ask(launch(7, "claude", &dir), "action_result").await;
        assert_eq!(r["ok"], true, "{r}");
        assert_eq!(r["name"], "claude@proyecto");
        // Aparece como cualquier agente, con su carpeta y aceptando entrada.
        let a = wait_for(port, "agente lanzado", |a| {
            a.iter().any(|x| {
                x["name"] == "claude@proyecto"
                    && x["last_lines"]
                        .as_array()
                        .is_some_and(|l| l.iter().any(|s| s.as_str().unwrap().contains("claude falso en")))
            })
        });
        let agent = a.iter().find(|x| x["name"] == "claude@proyecto").unwrap().clone();
        assert_eq!(agent["accepts_input"], true);
        assert_eq!(agent["project"], std::fs::canonicalize(&proyecto).unwrap().display().to_string());
        assert!(agent["launch"]["id"].is_string(), "{agent}");
        let id = agent["id"].as_str().unwrap().to_string();

        let r = ask(
            serde_json::json!({"type": "input", "id": id, "rid": 8,
                "input": {"type": "text", "text": "hola", "submit": true}}),
            "input_result",
        )
        .await;
        assert_eq!(r["ok"], true, "{r}");
        wait_for(port, "eco del agente", |a| {
            a.iter().any(|x| {
                x["last_lines"]
                    .as_array()
                    .is_some_and(|l| l.iter().any(|s| s.as_str().unwrap().contains("dijiste: hola")))
            })
        });

        let r = ask(serde_json::json!({"type": "stop", "rid": 9, "id": id}), "action_result").await;
        assert_eq!(r["ok"], true, "{r}");
        wait_for(port, "agente detenido", |a| {
            a.iter()
                .any(|x| x["name"] == "claude@proyecto" && x["state"] == "exited")
        });
        agent
    });

    if use_tmux {
        assert_eq!(launched["launch"]["tmux_session"], "argos-claude-proyecto");
        assert_eq!(
            launched["launch"]["attach"],
            format!("tmux -L {socket} attach -t argos-claude-proyecto")
        );
        let _ = Command::new("tmux")
            .args(["-L", &socket, "kill-server"])
            .stderr(Stdio::null())
            .status();
    } else {
        assert!(launched["launch"]["tmux_session"].is_null());
    }
}

#[test]
fn launch_hidden_agent_from_the_page() {
    launch_flow(false);
}

#[test]
fn launch_agent_in_tmux_from_the_page() {
    if Command::new("tmux").arg("-V").output().is_err() {
        eprintln!("sin tmux: se salta");
        return;
    }
    launch_flow(true);
}

// ---- Acceso desde la red: emparejamiento por código y dispositivos ----

/// IP privada de esta máquina (la de la interfaz de salida), si la hay. No envía nada:
/// conectar un socket UDP solo hace que el sistema elija la interfaz.
fn lan_ip() -> Option<std::net::IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.0.2.1:9").ok()?;
    match sock.local_addr().ok()?.ip() {
        ip @ std::net::IpAddr::V4(v4) if v4.is_private() => Some(ip),
        _ => None,
    }
}

fn start_server_args(cfg: &Path, port: u16, extra: &[&str], ready_ip: &str) -> Server {
    let child = Command::new(BIN)
        .args(["serve", "--port", &port.to_string()])
        .args(extra)
        .env("ARGOS_BOARD_CONFIG_DIR", cfg)
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while std::net::TcpStream::connect((ready_ip, port)).is_err()
        || std::net::TcpStream::connect(("127.0.0.1", port)).is_err()
    {
        assert!(Instant::now() < deadline, "el servidor no arrancó");
        std::thread::sleep(Duration::from_millis(50));
    }
    Server(child)
}

/// Petición HTTP/1.1 mínima a `ip:port` con cabeceras y cuerpo opcionales.
fn http_req(
    ip: &str,
    port: u16,
    method: &str,
    path: &str,
    host: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> (u16, String) {
    use std::io::Read;
    let mut s = std::net::TcpStream::connect((ip, port)).unwrap();
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    if !body.is_empty() {
        req.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        ));
    }
    write!(s, "{req}\r\n{body}").unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).unwrap();
    let status = buf.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = buf
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    (status, body)
}

fn cli(cfg: &Path, args: &[&str]) -> std::process::Output {
    Command::new(BIN)
        .args(args)
        .env("ARGOS_BOARD_CONFIG_DIR", cfg)
        .output()
        .unwrap()
}

/// Genera un código con `argos-board pair` y lo devuelve tal como se muestra.
fn new_pair_code(cfg: &Path) -> String {
    let out = cli(cfg, &["pair"]);
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    let code = text
        .lines()
        .find_map(|l| l.strip_prefix("Código de emparejamiento:"))
        .unwrap()
        .trim()
        .to_string();
    assert_eq!(code.len(), 9, "{code}"); // XXXX-XXXX
    code
}

fn pair_request(ip: &str, port: u16, code: &str) -> (u16, Value) {
    let (status, body) = http_req(
        ip,
        port,
        "POST",
        "/api/pair",
        &format!("{ip}:{port}"),
        &[("Origin", &format!("http://{ip}:{port}"))],
        &serde_json::json!({ "code": code, "name": "Pixel · Chrome" }).to_string(),
    );
    (status, serde_json::from_str(&body).unwrap_or(Value::Null))
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn ws_connect(ip: &str, port: u16) -> Ws {
    let mut req = format!("ws://{ip}:{port}/ws")
        .into_client_request()
        .unwrap();
    req.headers_mut()
        .insert("origin", format!("http://{ip}:{port}").parse().unwrap());
    tokio_tungstenite::connect_async(req).await.unwrap().0
}

async fn ws_next(ws: &mut Ws) -> Option<Value> {
    let msg = tokio::time::timeout(Duration::from_secs(12), ws.next())
        .await
        .expect("timeout esperando al servidor")?
        .ok()?;
    serde_json::from_str(msg.to_text().ok()?).ok()
}

async fn ws_send_auth(ws: &mut Ws, token: &str) {
    use futures_util::SinkExt;
    let msg = serde_json::json!({ "type": "auth", "token": token }).to_string();
    ws.send(tokio_tungstenite::tungstenite::Message::text(msg))
        .await
        .unwrap();
}

#[test]
fn remote_access_requires_a_paired_device() {
    let Some(lan) = lan_ip() else {
        eprintln!("sin IP privada en esta máquina: se omite");
        return;
    };
    let lan = lan.to_string();
    let cfg = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server_args(cfg.path(), port, &["--bind", &lan], &lan);
    let host = format!("{lan}:{port}");

    // La página se sirve (hace falta para mostrar el emparejamiento); los datos, no.
    assert_eq!(http_req(&lan, port, "GET", "/", &host, &[], "").0, 200);
    assert_eq!(
        http_req(&lan, port, "GET", "/api/agents", &host, &[], "").0,
        401
    );
    assert_eq!(
        http_get(port, "/api/agents", &format!("127.0.0.1:{port}")).0,
        200
    );
    // Host ajeno por la IP de la red → 403 (DNS rebinding).
    assert_eq!(
        http_req(&lan, port, "GET", "/", "evil.example", &[], "").0,
        403
    );

    // `serve` ya generó un código al arrancar (aún no hay dispositivos); lo descartamos.
    assert!(cfg.path().join("pairing.json").exists());
    std::fs::remove_file(cfg.path().join("pairing.json")).unwrap();

    // Sin código activo no se puede emparejar.
    let (status, body) = pair_request(&lan, port, "AAAA-AAAA");
    assert_eq!(status, 403, "{body}");
    assert!(body["error"].as_str().unwrap().contains("argos-board pair"));

    // Cinco fallos anulan el código, aunque el sexto intento fuera el correcto.
    let code = new_pair_code(cfg.path());
    for _ in 0..4 {
        assert_eq!(pair_request(&lan, port, "AAAA-AAAA").0, 403);
    }
    let (status, body) = pair_request(&lan, port, "AAAA-AAAA");
    assert_eq!(status, 403);
    assert!(body["error"].as_str().unwrap().contains("anuló"), "{body}");
    assert_eq!(pair_request(&lan, port, &code).0, 403);

    // Un código nuevo se canjea (minúsculas y sin guion también valen) una sola vez.
    let code = new_pair_code(cfg.path());
    let typed = code.replace('-', "").to_lowercase();
    let (status, body) = pair_request(&lan, port, &typed);
    assert_eq!(status, 200, "{body}");
    let token = body["token"].as_str().unwrap().to_string();
    let id = body["id"].as_str().unwrap().to_string();
    assert_eq!(pair_request(&lan, port, &code).0, 403);

    // Con el token del dispositivo se lee.
    let bearer = format!("Bearer {token}");
    let auth = [("Authorization", bearer.as_str())];
    assert_eq!(
        http_req(&lan, port, "GET", "/api/agents", &host, &auth, "").0,
        200
    );
    let bad = [("Authorization", "Bearer nope")];
    assert_eq!(
        http_req(&lan, port, "GET", "/api/agents", &host, &bad, "").0,
        401
    );

    // El comando `devices` lo lista.
    let list = String::from_utf8(cli(cfg.path(), &["devices"]).stdout).unwrap();
    assert!(
        list.contains(&id) && list.contains("Pixel · Chrome"),
        "{list}"
    );

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        // Desde la red, el WebSocket no muestra nada sin autenticarse.
        let mut ws = ws_connect(&lan, port).await;
        assert_eq!(ws_next(&mut ws).await.unwrap()["type"], "auth_required");
        // El token de control (el del enlace de `serve`) no vale desde la red.
        let control = std::fs::read_to_string(cfg.path().join("control-token")).unwrap();
        ws_send_auth(&mut ws, control.trim()).await;
        let reply = ws_next(&mut ws).await.unwrap();
        assert_eq!(
            (reply["type"].as_str(), reply["ok"].as_bool()),
            (Some("auth_result"), Some(false))
        );

        // Con el del dispositivo: autoriza y recién entonces llega el estado.
        let mut ws = ws_connect(&lan, port).await;
        assert_eq!(ws_next(&mut ws).await.unwrap()["type"], "auth_required");
        ws_send_auth(&mut ws, &token).await;
        let reply = ws_next(&mut ws).await.unwrap();
        assert_eq!(
            (reply["type"].as_str(), reply["ok"].as_bool()),
            (Some("auth_result"), Some(true))
        );
        loop {
            let msg = ws_next(&mut ws).await.unwrap();
            if msg["type"] == "snapshot" {
                break;
            }
            // Tras autenticar llegan la info de lanzamiento y la de voz, y luego el estado.
            assert!(
                ["launch_info", "voice_info"].contains(&msg["type"].as_str().unwrap()),
                "{msg}"
            );
        }

        // La ingesta de wrappers no se ofrece a la red.
        let mut req = format!("ws://{lan}:{port}/ingest")
            .into_client_request()
            .unwrap();
        let token_file = std::fs::read_to_string(cfg.path().join("token")).unwrap();
        req.headers_mut().insert(
            "authorization",
            format!("Bearer {}", token_file.trim()).parse().unwrap(),
        );
        assert!(tokio_tungstenite::connect_async(req).await.is_err());

        // Revocar corta la sesión abierta y cierra la lectura.
        let out = cli(cfg.path(), &["revoke", &id[..4]]);
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            match tokio::time::timeout(Duration::from_secs(1), ws.next()).await {
                Ok(None) | Ok(Some(Err(_))) => break,
                Ok(Some(Ok(m))) if m.is_close() => break,
                _ => assert!(
                    Instant::now() < deadline,
                    "la sesión revocada sigue abierta"
                ),
            }
        }
    });
    assert_eq!(
        http_req(&lan, port, "GET", "/api/agents", &host, &auth, "").0,
        401
    );
    assert!(!cli(cfg.path(), &["revoke", "zzz"]).status.success());
}

#[test]
fn bind_rejects_unsafe_addresses() {
    let cfg = tempfile::tempdir().unwrap();
    for ip in ["0.0.0.0", "::", "8.8.8.8"] {
        let out = Command::new(BIN)
            .args(["serve", "--port", &free_port().to_string(), "--bind", ip])
            .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
            .output()
            .unwrap();
        assert!(!out.status.success(), "--bind {ip} debía fallar");
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("--bind"),
            "{ip}"
        );
    }
}

/// Arranca `serve` con la salida de error en `log` y espera a que termine de anunciar dónde escucha.
fn start_serve_logged(cfg: &Path, port: u16, args: &[&str], log: &Path) -> Server {
    let server = Server(
        Command::new(BIN)
            .args(["serve", "--port", &port.to_string()])
            .args(args)
            .env("ARGOS_BOARD_CONFIG_DIR", cfg)
            .stderr(std::fs::File::create(log).unwrap())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let text = std::fs::read_to_string(log).unwrap_or_default();
        let announced = ["Desde el celular", "--local-only", "No encontré"]
            .iter()
            .any(|m| text.contains(m));
        if announced && std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return server;
        }
        assert!(Instant::now() < deadline, "el servidor no arrancó: {text}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn serve_offers_the_network_by_default_and_shows_a_pairing_code() {
    let Some(lan) = lan_ip() else {
        eprintln!("sin IP privada en esta máquina: se omite");
        return;
    };
    let lan = lan.to_string();
    let cfg = tempfile::tempdir().unwrap();
    let logs = tempfile::tempdir().unwrap();
    let port = free_port();

    // Sin flags: escucha también en la red y dice desde dónde conectarse, con el código.
    let log = logs.path().join("serve1.log");
    let server = start_serve_logged(cfg.path(), port, &[], &log);
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(text.contains(&format!("http://{lan}:{port}/")), "{text}");
    let code = text
        .lines()
        .find_map(|l| l.strip_prefix("Código de emparejamiento:"))
        .unwrap_or_else(|| panic!("serve no mostró el código: {text}"))
        .trim()
        .to_string();
    assert_eq!(
        http_req(&lan, port, "GET", "/", &format!("{lan}:{port}"), &[], "").0,
        200
    );

    // Ese código, sin ejecutar `pair`, empareja el primer dispositivo.
    let (status, body) = pair_request(&lan, port, &code);
    assert_eq!(status, 200, "{body}");
    drop(server);

    // Con un dispositivo ya emparejado no se genera un código nuevo en cada arranque.
    let log = logs.path().join("serve2.log");
    let _server = start_serve_logged(cfg.path(), port, &[], &log);
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(text.contains("1 dispositivo(s) emparejado(s)"), "{text}");
    assert!(!text.contains("Código de emparejamiento"), "{text}");
}

#[test]
fn local_only_keeps_the_server_off_the_network() {
    let Some(lan) = lan_ip() else {
        eprintln!("sin IP privada en esta máquina: se omite");
        return;
    };
    let cfg = tempfile::tempdir().unwrap();
    let logs = tempfile::tempdir().unwrap();
    let port = free_port();
    let log = logs.path().join("serve.log");
    let _server = start_serve_logged(cfg.path(), port, &["--local-only"], &log);
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(!text.contains("Código de emparejamiento"), "{text}");
    assert!(std::net::TcpStream::connect((lan.to_string().as_str(), port)).is_err());
    assert_eq!(
        http_get(port, "/api/agents", &format!("127.0.0.1:{port}")).0,
        200
    );
}

// ---- Dictado por voz: servidor + `agy` falso ----

/// Carpeta con un `agy` (el falso de tests/fake_agy.py) al principio del PATH.
fn path_with_fake_agy(dir: &Path) -> String {
    let fake = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake_agy.py");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&fake, dir.join("agy")).unwrap();
    format!(
        "{}:{}",
        dir.display(),
        std::env::var("PATH").unwrap_or_default()
    )
}

async fn ws_local(port: u16) -> Ws {
    ws_connect("127.0.0.1", port).await
}

/// Lee mensajes hasta que `pred` acepte uno (devuelve todos los vistos, el último incluido).
async fn ws_until(ws: &mut Ws, what: &str, pred: impl Fn(&Value) -> bool) -> Vec<Value> {
    let mut seen = Vec::new();
    loop {
        let msg = ws_next(ws)
            .await
            .unwrap_or_else(|| panic!("se cerró esperando {what}: {seen:#?}"));
        let done = pred(&msg);
        seen.push(msg);
        if done {
            return seen;
        }
    }
}

async fn ws_send_json(ws: &mut Ws, v: Value) {
    use futures_util::SinkExt;
    ws.send(tokio_tungstenite::tungstenite::Message::text(v.to_string()))
        .await
        .unwrap();
}

async fn ws_send_audio(ws: &mut Ws, frames: usize, byte: u8) {
    use futures_util::SinkExt;
    for _ in 0..frames {
        ws.send(tokio_tungstenite::tungstenite::Message::binary(vec![
            byte;
            640
        ]))
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await; // 640 B = 20 ms de audio
    }
}

fn is_type(v: &Value, t: &str) -> bool {
    v["type"] == t
}

/// Autentica una conexión local y devuelve lo que llegó hasta `voice_info`.
async fn ws_login(ws: &mut Ws, cfg: &Path) -> Vec<Value> {
    assert_eq!(ws_next(ws).await.unwrap()["type"], "snapshot");
    let control = std::fs::read_to_string(cfg.join("control-token")).unwrap();
    ws_send_auth(ws, control.trim()).await;
    ws_until(ws, "voice_info", |m| is_type(m, "voice_info")).await
}

#[test]
fn voice_dictation_streams_audio_to_agy_and_returns_the_text() {
    let cfg = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server_with(cfg.path(), port, &path_with_fake_agy(bin.path()), &[]);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let mut ws = ws_local(port).await;
        let info = ws_login(&mut ws, cfg.path()).await;
        assert_eq!(info.last().unwrap()["available"], true);

        // Sin credencial, nadie dicta.
        let mut stranger = ws_local(port).await;
        assert_eq!(ws_next(&mut stranger).await.unwrap()["type"], "snapshot");
        ws_send_json(&mut stranger, serde_json::json!({"type": "voice_start"})).await;
        let err = ws_next(&mut stranger).await.unwrap();
        assert!(is_type(&err, "voice_error"), "{err}");

        // Dictado completo: arranque (confianza incluida), audio, final.
        ws_send_json(&mut ws, serde_json::json!({"type": "voice_start"})).await;
        // Mientras agy arranca, el audio ya se acumula: no se pierde.
        ws_send_audio(&mut ws, 25, 5).await;
        let seen = ws_until(&mut ws, "recording", |m| {
            is_type(m, "voice_state") && m["state"] == "recording"
        })
        .await;
        assert_eq!(seen.first().unwrap()["state"], "preparing");
        ws_send_audio(&mut ws, 25, 5).await; // 25 + 25 tramas de 640 B
        // Otra sesión no puede dictar a la vez.
        let mut other = ws_local(port).await;
        let _ = ws_login(&mut other, cfg.path()).await;
        ws_send_json(&mut other, serde_json::json!({"type": "voice_start"})).await;
        let busy = ws_next(&mut other).await.unwrap();
        assert!(
            is_type(&busy, "voice_error") && busy["message"].as_str().unwrap().contains("en curso"),
            "{busy}"
        );

        ws_send_json(&mut ws, serde_json::json!({"type": "voice_stop"})).await;
        let seen = ws_until(&mut ws, "texto final", |m| {
            is_type(m, "voice_text") && m["is_final"] == true
        })
        .await;
        // 50 tramas de 640 B con el byte 5: ninguno se perdió ni se coló el silencio.
        assert_eq!(seen.last().unwrap()["text"], "heard 32000", "{seen:#?}");
        assert!(
            seen.iter()
                .any(|m| is_type(m, "voice_state") && m["state"] == "finishing")
        );
        let idle = ws_until(&mut ws, "idle", |m| {
            is_type(m, "voice_state") && m["state"] == "idle"
        })
        .await;
        assert!(idle.iter().all(|m| !is_type(m, "voice_error")), "{idle:#?}");

        // Se puede dictar otra vez (la caja de agy quedó vacía) y cancelar descarta.
        ws_send_json(&mut ws, serde_json::json!({"type": "voice_start"})).await;
        ws_until(&mut ws, "recording", |m| {
            is_type(m, "voice_state") && m["state"] == "recording"
        })
        .await;
        ws_send_audio(&mut ws, 10, 7).await;
        ws_send_json(&mut ws, serde_json::json!({"type": "voice_cancel"})).await;
        let seen = ws_until(&mut ws, "idle", |m| {
            is_type(m, "voice_state") && m["state"] == "idle"
        })
        .await;
        assert!(
            seen.iter()
                .all(|m| !(is_type(m, "voice_text") && m["is_final"] == true)),
            "{seen:#?}"
        );

        // Y un tercer dictado empieza de cero (nada del anterior).
        ws_send_json(&mut ws, serde_json::json!({"type": "voice_start"})).await;
        ws_until(&mut ws, "recording", |m| {
            is_type(m, "voice_state") && m["state"] == "recording"
        })
        .await;
        ws_send_audio(&mut ws, 10, 9).await;
        ws_send_json(&mut ws, serde_json::json!({"type": "voice_stop"})).await;
        let seen = ws_until(&mut ws, "texto final", |m| {
            is_type(m, "voice_text") && m["is_final"] == true
        })
        .await;
        assert_eq!(seen.last().unwrap()["text"], "heard 6400", "{seen:#?}");
    });
}

#[test]
fn voice_is_unavailable_without_agy() {
    let cfg = tempfile::tempdir().unwrap();
    let empty = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server_with(cfg.path(), port, &empty.path().display().to_string(), &[]);
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let mut ws = ws_local(port).await;
        let info = ws_login(&mut ws, cfg.path()).await;
        assert_eq!(info.last().unwrap()["available"], false);
        ws_send_json(&mut ws, serde_json::json!({"type": "voice_start"})).await;
        let err = ws_next(&mut ws).await.unwrap();
        assert!(is_type(&err, "voice_error"), "{err}");
    });
}

fn http_post(port: u16, path: &str, token: Option<&str>, body: &[u8]) -> (u16, String) {
    use std::io::Read;
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    let auth = token
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes()).unwrap();
    s.write_all(body).unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).unwrap();
    let status = buf.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body_str = buf
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    (status, body_str)
}

#[test]
fn upload_file_to_agent_project() {
    let cfg = tempfile::tempdir().unwrap();
    let port = free_port();
    let _server = start_server(cfg.path(), port);

    let project = tempfile::tempdir().unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake_agent.sh");
    let mut wrapper = Command::new(BIN)
        .args([
            "run",
            "--name",
            "fake@upload",
            "--project",
            &project.path().display().to_string(),
            "--port",
            &port.to_string(),
            "--",
            "sh",
            &script.display().to_string(),
            "pregunta",
        ])
        .env("ARGOS_BOARD_CONFIG_DIR", cfg.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    let list = wait_for(port, "fake@upload", |a| {
        a.iter().any(|x| x["name"] == "fake@upload")
    });
    let agent_id = list
        .iter()
        .find(|x| x["name"] == "fake@upload")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let control = std::fs::read_to_string(cfg.path().join("control-token")).unwrap();

    // 1. Subida no autorizada (sin token) -> 401
    let (status, resp) = http_post(
        port,
        &format!("/api/agents/{agent_id}/upload?name=test.md"),
        None,
        b"# Hola",
    );
    assert_eq!(status, 401, "{resp}");

    // 2. Subida con token correcto -> 200
    let md_content = b"# Documento Markdown\nDetalles del proyecto";
    let (status, resp) = http_post(
        port,
        &format!("/api/agents/{agent_id}/upload?name=documento.md"),
        Some(control.trim()),
        md_content,
    );
    assert_eq!(status, 200, "{resp}");
    let v: serde_json::Value = serde_json::from_str(&resp).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["relative_path"], ".argos/uploads/documento.md");
    assert_eq!(v["is_image"], false);

    // Verificar en disco
    let uploaded_file = project.path().join(".argos/uploads/documento.md");
    assert_eq!(std::fs::read(&uploaded_file).unwrap(), md_content);
    let gitignore = project.path().join(".argos/.gitignore");
    assert!(gitignore.exists());

    // 3. Subida de imagen -> is_image true
    let (status, resp) = http_post(
        port,
        &format!("/api/agents/{agent_id}/upload?name=captura.png"),
        Some(control.trim()),
        b"fake png bytes",
    );
    assert_eq!(status, 200, "{resp}");
    let v: serde_json::Value = serde_json::from_str(&resp).unwrap();
    assert_eq!(v["is_image"], true);
    assert_eq!(v["relative_path"], ".argos/uploads/captura.png");

    let _ = wrapper.kill();
}
