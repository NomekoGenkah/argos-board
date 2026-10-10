//! `argos-board run -- <cmd>`: wrapper PTY transparente.

mod client;
mod dump;
pub mod screen;
mod term;

use crate::git;
use crate::model::{AgentKind, AgentState, IngestMsg};
use anyhow::{Context, Result, bail};
use chrono::Utc;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use screen::Screen;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub struct RunOptions {
    pub name: Option<String>,
    pub project: Option<PathBuf>,
    pub port: u16,
    pub dump_screens: Option<PathBuf>,
    pub command: Vec<String>,
}

const TICK: Duration = Duration::from_millis(250);
const GIT_EVERY: Duration = Duration::from_secs(5);

fn pty_size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Ejecuta el comando y devuelve su código de salida.
pub fn run(opts: RunOptions) -> Result<i32> {
    let Some(program) = opts.command.first().cloned() else {
        bail!("falta el comando a ejecutar")
    };
    let cwd = std::env::current_dir().context("leyendo el directorio actual")?;
    let project = match &opts.project {
        Some(p) => {
            std::fs::canonicalize(p).with_context(|| format!("--project {}", p.display()))?
        }
        None => cwd.clone(),
    };
    let kind = AgentKind::from_program(&program);
    let name = opts.name.clone().unwrap_or_else(|| {
        let bin = std::path::Path::new(&program)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned());
        let dir = project
            .file_name()
            .map(|s| s.to_string_lossy().into_owned());
        format!(
            "{}@{}",
            bin.unwrap_or(program.clone()),
            dir.unwrap_or_else(|| "/".into())
        )
    });

    let (rows, cols) = term::size();
    let pair = native_pty_system()
        .openpty(pty_size(rows, cols))
        .context("abriendo PTY")?;
    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&opts.command[1..]);
    cmd.cwd(&cwd);
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .with_context(|| format!("no se pudo ejecutar `{program}`"))?;
    drop(pair.slave);
    let pid = child.process_id();
    let mut killer = child.clone_killer();
    let master = pair.master;
    let mut pty_reader = master.try_clone_reader()?;
    let mut pty_writer = master.take_writer()?;

    let raw = term::RawModeGuard::enable().context("activando modo raw")?;
    let screen = Arc::new(Mutex::new(Screen::new(rows, cols)));

    // PTY → stdout + emulador.
    let (reader_done_tx, reader_done_rx) = std::sync::mpsc::channel::<()>();
    {
        let screen = screen.clone();
        std::thread::spawn(move || {
            let mut stdout = std::io::stdout();
            let mut buf = [0u8; 8192];
            loop {
                match pty_reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let _ = stdout.write_all(&buf[..n]);
                        let _ = stdout.flush();
                        screen.lock().unwrap().process(&buf[..n], Instant::now());
                    }
                }
            }
            let _ = reader_done_tx.send(());
        });
    }
    // stdin → PTY (bytes tal cual: Ctrl+C y demás llegan al hijo).
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 4096];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if pty_writer.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    let _ = pty_writer.flush();
                }
            }
        }
    });

    let mut dumper = opts.dump_screens.as_ref().and_then(|d| {
        dump::Dumper::new(d.clone(), &name, &format!("{kind:?}").to_lowercase()).ok()
    });

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let code = rt.block_on(async move {
        let (tx, rx) = mpsc::unbounded_channel();
        let client = tokio::spawn(client::run(opts.port, rx));

        let started_at = Utc::now();
        let mut branch = git::current_branch(&project);
        let _ = tx.send(IngestMsg::Hello {
            id: uuid::Uuid::new_v4(),
            name,
            kind,
            project: project.display().to_string(),
            pid,
            started_at,
            git_branch: branch.clone(),
        });
        let _ = tx.send(IngestMsg::State { state: AgentState::Idle, since: started_at });

        let mut wait = tokio::task::spawn_blocking(move || child.wait());
        let mut tick = tokio::time::interval(TICK);
        let mut last_git = Instant::now();
        let mut last_lines: Vec<String> = Vec::new();
        let mut signals = signals::Signals::new();

        let status = loop {
            tokio::select! {
                res = &mut wait => break res,
                _ = tick.tick() => {
                    let now = Instant::now();
                    let (changed, lines, out_at) = {
                        let mut s = screen.lock().unwrap();
                        let changed = s.activity.tick(now);
                        if let (Some(st), Some(d)) = (changed, dumper.as_mut()) {
                            d.dump(st.as_str(), s.size(), &s.contents());
                        }
                        (changed, s.last_lines(), s.last_output_at)
                    };
                    if let Some(state) = changed {
                        let _ = tx.send(IngestMsg::State { state, since: Utc::now() });
                    }
                    if lines != last_lines {
                        last_lines = lines.clone();
                        let _ = tx.send(IngestMsg::Screen { last_lines: lines, last_output_at: out_at });
                    }
                    if last_git.elapsed() >= GIT_EVERY {
                        last_git = now;
                        let p = project.clone();
                        if let Ok(b) = tokio::task::spawn_blocking(move || git::current_branch(&p)).await
                            && b != branch
                        {
                            branch = b.clone();
                            let _ = tx.send(IngestMsg::Git { branch: b });
                        }
                    }
                }
                ev = signals.next() => match ev {
                    signals::Event::Resize => {
                        let (rows, cols) = term::size();
                        let _ = master.resize(pty_size(rows, cols));
                        screen.lock().unwrap().set_size(rows, cols);
                    }
                    signals::Event::Terminate => {
                        // SIGTERM/SIGHUP al wrapper: se termina el hijo y se sale por el camino normal.
                        let _ = killer.kill();
                    }
                },
            }
        };

        // Deja que el lector vacíe la salida pendiente (con límite: puede haber nietos con el PTY abierto).
        let _ = tokio::task::spawn_blocking(move || reader_done_rx.recv_timeout(Duration::from_millis(300))).await;

        let code = match status {
            Ok(Ok(st)) => st.exit_code() as i32,
            _ => 1,
        };
        {
            let s = screen.lock().unwrap();
            let _ = tx.send(IngestMsg::Screen { last_lines: s.last_lines(), last_output_at: s.last_output_at });
            if let Some(d) = dumper.as_mut() {
                d.dump(AgentState::Exited.as_str(), s.size(), &s.contents());
            }
        }
        let _ = tx.send(IngestMsg::Exit { code });
        drop(tx);
        let _ = tokio::time::timeout(Duration::from_secs(1), client).await;
        code
    });
    rt.shutdown_timeout(Duration::from_millis(100));
    drop(raw);
    Ok(code)
}

#[cfg(unix)]
mod signals {
    use tokio::signal::unix::{Signal, SignalKind, signal};

    pub enum Event {
        Resize,
        Terminate,
    }

    pub struct Signals {
        winch: Option<Signal>,
        term: Option<Signal>,
        hup: Option<Signal>,
    }

    impl Signals {
        pub fn new() -> Self {
            Self {
                winch: signal(SignalKind::window_change()).ok(),
                term: signal(SignalKind::terminate()).ok(),
                hup: signal(SignalKind::hangup()).ok(),
            }
        }

        async fn recv(s: &mut Option<Signal>) {
            match s {
                Some(s) => {
                    s.recv().await;
                }
                None => std::future::pending().await,
            }
        }

        pub async fn next(&mut self) -> Event {
            tokio::select! {
                _ = Self::recv(&mut self.winch) => Event::Resize,
                _ = Self::recv(&mut self.term) => Event::Terminate,
                _ = Self::recv(&mut self.hup) => Event::Terminate,
            }
        }
    }
}

#[cfg(not(unix))]
mod signals {
    pub enum Event {
        Resize,
        Terminate,
    }

    pub struct Signals;

    impl Signals {
        pub fn new() -> Self {
            Self
        }

        pub async fn next(&mut self) -> Event {
            std::future::pending().await
        }
    }
}
