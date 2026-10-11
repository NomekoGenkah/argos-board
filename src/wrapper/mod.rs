//! `argos-board run -- <cmd>`: wrapper PTY transparente.

mod client;
mod dump;
mod input;
pub mod screen;
mod term;

use crate::git;
use crate::model::{AgentKind, AgentState, IngestMsg, Input};
use crate::profiles::Profile;
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
    /// No aceptar entrada desde la web.
    pub no_input: bool,
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
    // Antes del modo raw: un aviso aquí se ve limpio y el agente arranca igual.
    let (profile, warnings) = Profile::load(kind);
    for w in warnings {
        eprintln!("argos-board: {w}");
    }
    let (allow_input, warning) =
        crate::config::allow_input(crate::config::user_config().as_deref());
    if let Some(w) = warning {
        eprintln!("argos-board: {w}");
    }
    let accepts_input = allow_input && !opts.no_input;
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
    // Lo comparten el teclado local y la entrada desde la web.
    let pty_writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(master.take_writer()?));

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
    let stdin_is_tty = std::io::IsTerminal::is_terminal(&std::io::stdin());
    let local_writer = pty_writer.clone();
    std::thread::spawn(move || {
        let pty_writer = local_writer;
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 4096];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => {
                    // Fin de la entrada (stdin redirigido): el agente recibe EOF
                    // como si se hubiera pulsado Ctrl+D. En una terminal no ocurre.
                    if !stdin_is_tty {
                        let mut w = pty_writer.lock().unwrap();
                        let _ = w.write_all(&[0x04]);
                        let _ = w.flush();
                    }
                    break;
                }
                Err(_) => break,
                Ok(n) => {
                    let mut w = pty_writer.lock().unwrap();
                    if w.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    let _ = w.flush();
                }
            }
        }
    });

    // Entrada desde la web → PTY, en orden y con la pausa antes del Enter.
    let input_tx = accepts_input.then(|| {
        let (tx, rx) = std::sync::mpsc::channel::<Input>();
        let screen = screen.clone();
        let writer = pty_writer.clone();
        std::thread::spawn(move || {
            for cmd in rx {
                let modes = screen.lock().unwrap().input_modes();
                for (i, chunk) in input::chunks(&cmd, modes).iter().enumerate() {
                    if i > 0 {
                        std::thread::sleep(input::SUBMIT_DELAY);
                    }
                    let mut w = writer.lock().unwrap();
                    if w.write_all(chunk).and_then(|_| w.flush()).is_err() {
                        return;
                    }
                }
            }
        });
        tx
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
        let client = tokio::spawn(client::run(opts.port, rx, input_tx));

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
            version: Some(crate::VERSION.to_string()),
            accepts_input,
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
                    let (changed, pattern, lines, out_at) = {
                        let mut s = screen.lock().unwrap();
                        let pattern = profile.classify(&s.contents());
                        let changed = s.activity.tick(now, pattern);
                        if let (Some(st), Some(d)) = (changed, dumper.as_mut()) {
                            d.dump(st.as_str(), s.size(), &s.contents());
                        }
                        (changed, pattern, s.last_lines(), s.last_output_at)
                    };
                    if let Some(state) = changed {
                        tracing::debug!(state = state.as_str(), por_patron = pattern.is_some(), "cambio de estado");
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
            Ok(Ok(st)) => exit_code(&st),
            _ => 1,
        };
        tracing::info!(code, "el agente terminó");
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

/// Código de salida al estilo de la shell: el del hijo, o 128 + N si murió por
/// la señal N (130 con Ctrl+C, 143 con `kill`).
fn exit_code(status: &portable_pty::ExitStatus) -> i32 {
    match status.signal() {
        Some(name) => signal_number(name).map_or(1, |n| 128 + n),
        None => status.exit_code() as i32,
    }
}

/// portable-pty solo da el nombre de la señal (el texto de `strsignal`, que
/// puede venir traducido): se busca el número que produce ese mismo texto.
#[cfg(unix)]
fn signal_number(name: &str) -> Option<i32> {
    if let Some(n) = name.strip_prefix("Signal ").and_then(|n| n.parse().ok()) {
        return Some(n);
    }
    (1..65).find(|&n| {
        // SAFETY: strsignal devuelve un puntero a una cadena estática (o NULL);
        // se copia enseguida y solo se llama una vez, al terminar el agente.
        let ptr = unsafe { libc::strsignal(n) };
        !ptr.is_null() && unsafe { std::ffi::CStr::from_ptr(ptr) }.to_string_lossy() == name
    })
}

#[cfg(not(unix))]
fn signal_number(_name: &str) -> Option<i32> {
    None
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn signal_numbers_from_names() {
        for n in [2, 9, 15] {
            let name = unsafe { std::ffi::CStr::from_ptr(libc::strsignal(n)) }
                .to_string_lossy()
                .into_owned();
            assert_eq!(signal_number(&name), Some(n), "{name}");
        }
        assert_eq!(signal_number("Signal 42"), Some(42));
        assert_eq!(signal_number("no es una señal"), None);
        assert_eq!(exit_code(&portable_pty::ExitStatus::with_exit_code(3)), 3);
    }
}
