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
        .args(["serve", "--port", &port.to_string()])
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
