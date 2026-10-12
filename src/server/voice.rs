//! Dictado por voz en el servidor.
//!
//! Un `agy` (Antigravity CLI) oculto, dentro de un PTY, hace de transcriptor: se le
//! pulsa F5 como a un usuario y su dictado (el servicio de voz de Google, el mismo de su
//! `/voice`) lee el audio de `ANTIGRAVITY_MIC`, que aquí es un puerto de esta máquina
//! que imita a `agy mic-serve` (PCM de 16 kHz, 16 bits, mono, sin cabecera, a ritmo
//! real). El audio llega desde el micrófono de la página; el texto se lee de la caja de
//! `agy` y vuelve a la página, que lo escribe en la consola de cualquier agente.
//!
//! Se usa `agy` aunque el agente al que se le habla sea otro (claude, opencode…): la voz
//! queda igual para todos y el micrófono puede estar en otro dispositivo.

use crate::config;
use crate::model::{BrowserMsg, VoiceState};
use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;

const ROWS: u16 = 30;
const COLS: u16 = 100;
const F5: &[u8] = b"\x1b[15~";
const ESC: &[u8] = b"\x1b";
const ENTER: &[u8] = b"\r";
const CTRL_U: &[u8] = b"\x15";

/// 10 ms de audio (16 kHz, 16 bits, mono), el trozo con el que `agy mic-serve` emite.
const CHUNK: usize = 320;
const BYTES_PER_SECOND: usize = 32_000;
/// Audio pendiente que se conserva (si la página va más rápido que el transcriptor).
const MAX_QUEUE: usize = 60 * BYTES_PER_SECOND;
/// Mensajes binarios más grandes que esto no son audio de la página.
pub const MAX_AUDIO_MESSAGE: usize = 16 * 1024;

const PREPARE_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(150);
/// Silencio que se añade al final para que el reconocedor cierre la última frase.
const TAIL_SILENCE: Duration = Duration::from_millis(900);

// ---- Lectura de la pantalla de agy ----

fn is_rule(line: &str) -> bool {
    let t = line.trim();
    t.chars().count() >= 10 && t.chars().all(|c| c == '─')
}

/// Texto de la caja de entrada de `agy` (entre las dos últimas líneas horizontales), o
/// `None` si no hay caja (arrancando, diálogo de confianza…). `agy` envuelve el texto por
/// palabras con dos espacios de sangría en las líneas de continuación.
pub fn prompt_text(screen: &str) -> Option<String> {
    let lines: Vec<&str> = screen.lines().collect();
    let rules: Vec<usize> = (0..lines.len()).filter(|&i| is_rule(lines[i])).collect();
    let [.., first_rule, last_rule] = rules[..] else {
        return None;
    };
    let body = &lines[first_rule + 1..last_rule];
    let rest = body.first()?.trim_start().strip_prefix('>')?;
    let parts: Vec<&str> = std::iter::once(rest)
        .chain(body[1..].iter().copied())
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    Some(parts.join(" "))
}

/// `agy` pregunta si se confía en la carpeta (la de este módulo, vacía).
fn needs_trust(screen: &str) -> bool {
    screen.contains("Do you trust the contents of this project?")
}

/// ¿Está grabando? (`● Recording 00:03  enter or f5 to insert…`)
fn is_recording(screen: &str) -> bool {
    screen.lines().any(|l| {
        let t = l.trim_start();
        (t.starts_with('●') || t.starts_with('○')) && t.contains("Recording")
    })
}

/// Último aviso de `agy` (`⎿ No audio is being picked up…`), si lo hay.
fn notice(screen: &str) -> Option<String> {
    let lines: Vec<&str> = screen.lines().collect();
    let at = lines
        .iter()
        .rposition(|l| l.trim_start().starts_with('⎿'))?;
    let mut parts = vec![
        lines[at]
            .trim_start()
            .trim_start_matches('⎿')
            .trim()
            .to_string(),
    ];
    for l in &lines[at + 1..] {
        if l.trim().is_empty() || is_rule(l) || !l.starts_with(' ') {
            break;
        }
        parts.push(l.trim().to_string());
    }
    Some(parts.join(" "))
}

// ---- Audio hacia agy ----

/// Audio de la página pendiente de entregar a `agy`, y si `agy` está conectado.
struct Audio {
    queue: Mutex<VecDeque<u8>>,
    connected: AtomicBool,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Audio {
    fn new() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            connected: AtomicBool::new(false),
        }
    }

    fn push(&self, data: &[u8]) {
        let mut q = lock(&self.queue);
        q.extend(data);
        let over = q.len().saturating_sub(MAX_QUEUE);
        q.drain(..over);
    }

    fn clear(&self) {
        lock(&self.queue).clear();
    }

    fn len(&self) -> usize {
        lock(&self.queue).len()
    }

    /// El siguiente trozo; si no hay audio, silencio (un micrófono nunca deja de emitir).
    fn next_chunk(&self) -> [u8; CHUNK] {
        let mut chunk = [0u8; CHUNK];
        let mut q = lock(&self.queue);
        for byte in chunk.iter_mut() {
            match q.pop_front() {
                Some(b) => *byte = b,
                None => break,
            }
        }
        chunk
    }
}

/// Hace de `agy mic-serve`: a cada conexión de `agy` le emite audio a ritmo real.
fn serve_mic(listener: TcpListener, audio: Arc<Audio>) {
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let _ = stream.set_nodelay(true);
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        audio.connected.store(true, Ordering::SeqCst);
        let mut next = Instant::now();
        loop {
            if stream.write_all(&audio.next_chunk()).is_err() {
                break;
            }
            next += Duration::from_millis(10);
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else if now - next > Duration::from_millis(200) {
                next = now; // se atrasó: no intentar recuperar de golpe
            }
        }
        audio.connected.store(false, Ordering::SeqCst);
    }
}

// ---- El agy oculto ----

struct Transcriber {
    writer: Mutex<Box<dyn Write + Send>>,
    parser: Arc<Mutex<vt100::Parser>>,
    alive: Arc<AtomicBool>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    _master: Mutex<Box<dyn MasterPty + Send>>,
    last_used: Mutex<Instant>,
}

impl Transcriber {
    fn spawn(agy: &Path, audio: Arc<Audio>) -> anyhow::Result<Arc<Self>> {
        use anyhow::Context;
        // Carpeta propia y vacía: es la que `agy` pide confiar la primera vez.
        let dir = config::config_dir()?.join("voice");
        std::fs::create_dir_all(&dir).with_context(|| format!("creando {}", dir.display()))?;

        let listener =
            TcpListener::bind(("127.0.0.1", 0)).context("abriendo el micrófono virtual")?;
        let port = listener.local_addr()?.port();
        std::thread::spawn(move || serve_mic(listener, audio));

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: ROWS,
                cols: COLS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("abriendo PTY")?;
        let mut cmd = CommandBuilder::new(agy);
        cmd.cwd(&dir);
        cmd.env("ANTIGRAVITY_MIC", format!("127.0.0.1:{port}"));
        cmd.env("TERM", "xterm-256color");
        for var in [
            "ARGOS_BOARD_LAUNCH_ID",
            "ARGOS_BOARD_TMUX_SESSION",
            "ARGOS_BOARD_TMUX_SOCKET",
            "ARGOS_BOARD_SIZE",
        ] {
            cmd.env_remove(var);
        }
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .with_context(|| format!("no se pudo ejecutar `{}`", agy.display()))?;
        drop(pair.slave);
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let parser = Arc::new(Mutex::new(vt100::Parser::new(ROWS, COLS, 0)));
        let alive = Arc::new(AtomicBool::new(true));
        {
            let (parser, alive) = (parser.clone(), alive.clone());
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    lock(&parser).process(&buf[..n]);
                }
                alive.store(false, Ordering::SeqCst);
            });
        }
        {
            let alive = alive.clone();
            std::thread::spawn(move || {
                let _ = Child::wait(&mut *child);
                alive.store(false, Ordering::SeqCst);
            });
        }
        Ok(Arc::new(Self {
            writer: Mutex::new(writer),
            parser,
            alive,
            killer: Mutex::new(killer),
            _master: Mutex::new(pair.master),
            last_used: Mutex::new(Instant::now()),
        }))
    }

    fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn send(&self, bytes: &[u8]) {
        let mut w = lock(&self.writer);
        let _ = w.write_all(bytes);
        let _ = w.flush();
    }

    fn screen(&self) -> String {
        lock(&self.parser).screen().contents()
    }

    fn touch(&self) {
        *lock(&self.last_used) = Instant::now();
    }

    /// Deja `agy` sin grabación ni texto en la caja.
    fn reset(&self) {
        if is_recording(&self.screen()) {
            self.send(ESC);
            std::thread::sleep(Duration::from_millis(300));
        }
        self.send(CTRL_U);
    }
}

impl Drop for Transcriber {
    fn drop(&mut self) {
        let _ = lock(&self.killer).kill();
    }
}

// ---- El concentrador ----

enum Stop {
    Finish,
    Discard,
}

struct Active {
    owner: u64,
    stop: Option<oneshot::Sender<Stop>>,
}

pub struct VoiceHub {
    agy: Option<PathBuf>,
    audio: Arc<Audio>,
    transcriber: Mutex<Option<Arc<Transcriber>>>,
    active: Mutex<Option<Active>>,
    next_owner: AtomicU64,
}

fn find_in_path(program: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join(program))
        .find(|p| p.is_file())
}

impl VoiceHub {
    pub fn new() -> Arc<Self> {
        let agy = if std::env::var_os("ARGOS_BOARD_NO_VOICE").is_some() {
            None
        } else {
            find_in_path("agy")
        };
        Arc::new(Self {
            agy,
            audio: Arc::new(Audio::new()),
            transcriber: Mutex::new(None),
            active: Mutex::new(None),
            next_owner: AtomicU64::new(1),
        })
    }

    /// ¿Se puede transcribir voz? (hay un `agy` instalado)
    pub fn available(&self) -> bool {
        self.agy.is_some()
    }

    pub fn new_owner(&self) -> u64 {
        self.next_owner.fetch_add(1, Ordering::Relaxed)
    }

    fn transcriber(&self) -> Result<Arc<Transcriber>, String> {
        let agy = self
            .agy
            .as_ref()
            .ok_or("no hay `agy` instalado para transcribir")?;
        let mut slot = lock(&self.transcriber);
        if let Some(t) = slot.as_ref()
            && t.alive()
        {
            t.touch();
            return Ok(t.clone());
        }
        let t = Transcriber::spawn(agy, self.audio.clone()).map_err(|e| format!("{e:#}"))?;
        *slot = Some(t.clone());
        Ok(t)
    }

    /// Arranca el transcriptor en segundo plano para que el primer dictado no espere.
    pub fn prepare(self: &Arc<Self>) {
        if !self.available() {
            return;
        }
        let hub = self.clone();
        tokio::task::spawn_blocking(move || {
            if let Err(e) = hub.transcriber() {
                tracing::warn!("no se pudo precalentar el transcriptor de voz: {e}");
            }
        });
    }

    /// Cierra el transcriptor si lleva `idle` sin usarse y no hay un dictado en curso.
    pub fn reap_idle(&self, idle: Duration) {
        if lock(&self.active).is_some() {
            return;
        }
        let mut slot = lock(&self.transcriber);
        if slot
            .as_ref()
            .is_some_and(|t| !t.alive() || lock(&t.last_used).elapsed() > idle)
        {
            *slot = None;
        }
    }

    /// Empieza un dictado para `owner`. Los eventos salen por `events`.
    pub fn start(
        self: &Arc<Self>,
        owner: u64,
        events: UnboundedSender<BrowserMsg>,
    ) -> Result<(), String> {
        if !self.available() {
            return Err("el servidor no puede transcribir voz (falta `agy`)".into());
        }
        let (stop_tx, stop_rx) = oneshot::channel();
        {
            let mut active = lock(&self.active);
            if active.is_some() {
                return Err("ya hay un dictado en curso".into());
            }
            *active = Some(Active {
                owner,
                stop: Some(stop_tx),
            });
        }
        self.audio.clear();
        let hub = self.clone();
        tokio::spawn(async move {
            if let Err(message) = hub.dictate(&events, stop_rx).await {
                let _ = events.send(BrowserMsg::VoiceError { message });
            }
            let _ = events.send(BrowserMsg::VoiceState {
                state: VoiceState::Idle,
            });
            let mut active = lock(&hub.active);
            if active.as_ref().is_some_and(|a| a.owner == owner) {
                *active = None;
            }
        });
        Ok(())
    }

    /// Audio de la página (PCM de 16 kHz, 16 bits, mono); se ignora si `owner` no dicta.
    pub fn push_audio(&self, owner: u64, data: &[u8]) {
        if lock(&self.active)
            .as_ref()
            .is_some_and(|a| a.owner == owner)
        {
            self.audio.push(data);
        }
    }

    fn signal(&self, owner: u64, stop: Stop) {
        let mut active = lock(&self.active);
        if let Some(a) = active.as_mut()
            && a.owner == owner
            && let Some(tx) = a.stop.take()
        {
            let _ = tx.send(stop);
        }
    }

    /// Termina el dictado de `owner` y entrega el texto final.
    pub fn finish(&self, owner: u64) {
        self.signal(owner, Stop::Finish);
    }

    /// Descarta el dictado de `owner` (o lo ignora si no dicta).
    pub fn cancel(&self, owner: u64) {
        self.signal(owner, Stop::Discard);
    }

    async fn dictate(
        &self,
        events: &UnboundedSender<BrowserMsg>,
        mut stop_rx: oneshot::Receiver<Stop>,
    ) -> Result<(), String> {
        let say = |state| {
            let _ = events.send(BrowserMsg::VoiceState { state });
        };
        // Un cierre de la sesión sin avisar (el emisor se soltó) equivale a descartar.
        let mut stop: Option<Stop> = None;
        let mut poll_stop = |stop: &mut Option<Stop>| {
            if stop.is_none() {
                match stop_rx.try_recv() {
                    Ok(s) => *stop = Some(s),
                    Err(oneshot::error::TryRecvError::Closed) => *stop = Some(Stop::Discard),
                    Err(oneshot::error::TryRecvError::Empty) => {}
                }
            }
        };

        say(VoiceState::Preparing);
        let t = self.transcriber_blocking().await?;

        // 1. Esperar a que agy esté listo (y aceptar la confianza de su carpeta vacía).
        let deadline = Instant::now() + PREPARE_TIMEOUT;
        let mut last_trust = None::<Instant>;
        loop {
            poll_stop(&mut stop);
            if stop.is_some() {
                return Ok(()); // se canceló antes de empezar a grabar
            }
            if !t.alive() {
                return Err("`agy` se cerró al arrancar".into());
            }
            let screen = t.screen();
            if needs_trust(&screen) {
                if last_trust.is_none_or(|at| at.elapsed() > Duration::from_secs(3)) {
                    t.send(ENTER);
                    last_trust = Some(Instant::now());
                }
            } else if prompt_text(&screen).is_some() {
                break;
            }
            if Instant::now() > deadline {
                return Err("`agy` no quedó listo (¿tiene la sesión iniciada?)".into());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        if prompt_text(&t.screen()).is_some_and(|p| !p.is_empty()) {
            t.send(CTRL_U);
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        // 2. Abrir el dictado de agy y esperar a que se conecte al micrófono virtual.
        t.send(F5);
        let connect_deadline = Instant::now() + CONNECT_TIMEOUT;
        while !(self.audio.connected.load(Ordering::SeqCst) && is_recording(&t.screen())) {
            poll_stop(&mut stop);
            if stop.is_some() {
                t.reset();
                return Ok(());
            }
            if !t.alive() || Instant::now() > connect_deadline {
                let why = notice(&t.screen()).unwrap_or_else(|| "no abrió el micrófono".into());
                t.reset();
                return Err(format!("`agy` no pudo empezar a dictar: {why}"));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        say(VoiceState::Recording);

        // 3. Grabando: el texto provisional va a la página a medida que cambia.
        let mut shown = String::new();
        let started = Instant::now();
        loop {
            poll_stop(&mut stop);
            if stop.is_some() {
                break;
            }
            let screen = t.screen();
            if !t.alive() {
                return Err("`agy` se cerró mientras se dictaba".into());
            }
            if !is_recording(&screen) && started.elapsed() > Duration::from_secs(2) {
                break; // agy cortó solo (límite de duración): se entrega lo que haya
            }
            let text = prompt_text(&screen).unwrap_or_default();
            if text != shown {
                shown = text.clone();
                let _ = events.send(BrowserMsg::VoiceText {
                    text,
                    is_final: false,
                });
            }
            tokio::time::sleep(POLL).await;
        }

        if matches!(stop, Some(Stop::Discard)) {
            t.reset();
            return Ok(());
        }

        // 4. Terminar: entregar el audio pendiente y un poco de silencio, y pedir el texto.
        say(VoiceState::Finishing);
        self.drain_audio().await;
        self.audio.push(&vec![
            0u8;
            BYTES_PER_SECOND * TAIL_SILENCE.as_millis() as usize
                / 1000
        ]);
        self.drain_audio().await;
        if is_recording(&t.screen()) {
            t.send(F5);
            let until = Instant::now() + Duration::from_secs(3);
            while is_recording(&t.screen()) && Instant::now() < until {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
        // El texto final tarda un instante en asentarse.
        let mut text = prompt_text(&t.screen()).unwrap_or_default();
        let mut stable_since = Instant::now();
        let settle_until = Instant::now() + Duration::from_secs(3);
        while stable_since.elapsed() < Duration::from_millis(500) && Instant::now() < settle_until {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let now_text = prompt_text(&t.screen()).unwrap_or_default();
            if now_text != text {
                text = now_text;
                stable_since = Instant::now();
            }
        }
        let why = notice(&t.screen());
        t.reset();
        if text.is_empty() {
            return Err(why.unwrap_or_else(|| "no se captó voz".into()));
        }
        let _ = events.send(BrowserMsg::VoiceText {
            text,
            is_final: true,
        });
        Ok(())
    }

    /// Crea el transcriptor sin bloquear el ejecutor (lanzar el PTY es trabajo bloqueante).
    async fn transcriber_blocking(&self) -> Result<Arc<Transcriber>, String> {
        // `spawn_blocking` pide 'static: se clona lo necesario.
        let agy = self.agy.clone();
        let audio = self.audio.clone();
        let existing = lock(&self.transcriber)
            .as_ref()
            .filter(|t| t.alive())
            .cloned();
        if let Some(t) = existing {
            t.touch();
            return Ok(t);
        }
        let agy = agy.ok_or("no hay `agy` instalado para transcribir")?;
        let t = tokio::task::spawn_blocking(move || Transcriber::spawn(&agy, audio))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("{e:#}"))?;
        *lock(&self.transcriber) = Some(t.clone());
        Ok(t)
    }

    /// Espera a que `agy` consuma el audio pendiente (a ritmo real).
    async fn drain_audio(&self) {
        let max = Duration::from_secs_f64(self.audio.len() as f64 / BYTES_PER_SECOND as f64 + 2.0);
        let until = Instant::now() + max;
        while self.audio.len() > 0 && Instant::now() < until {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/voice/agy")
            .join(name);
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn reads_a_wrapped_prompt_as_one_line() {
        let screen = fixture("dictado-largo-insertado.txt");
        assert_eq!(
            prompt_text(&screen).unwrap(),
            "This is a longer dictation to verify how the prompt wraps across several lines. \
             I want the board to read the whole transcript correctly, including punctuation, \
             numbers like 42, and a file name such as main.rs. Please then run the tests and \
             report the result back to me in a short summary."
        );
        assert!(!is_recording(&screen));
    }

    #[test]
    fn an_empty_box_is_empty_text() {
        let screen = fixture("caja-vacia.txt");
        assert_eq!(prompt_text(&screen).as_deref(), Some(""));
        assert!(!is_recording(&screen));
    }

    const RULE: &str = "────────────────────────────────────────────────────────────────────────────────────────────────────";

    #[test]
    fn recording_state_and_interim_text() {
        let screen = format!(
            "  banner\n{RULE}\n> Hello. This is a test\n{RULE}\n● Recording 00:05  enter or f5 to insert · esc to discard\n? for shortcuts   Gemini 3.8 Flash · high\n"
        );
        assert!(is_recording(&screen));
        assert_eq!(prompt_text(&screen).unwrap(), "Hello. This is a test");
        let screen = screen.replace('●', "○");
        assert!(is_recording(&screen), "el punto parpadea");
    }

    #[test]
    fn no_box_while_starting_or_asking_for_trust() {
        let trust = "Accessing workspace:\n~/.config/argos-board/voice\nDo you trust the contents of this project?\nAntigravity CLI requires permission to read, edit, and execute files here.\n> Yes, I trust this folder\n  No, exit\n  ↑/↓ Navigate · enter Confirm\n";
        assert!(needs_trust(trust));
        assert_eq!(prompt_text(trust), None, "el '>' del menú no es la caja");
        assert_eq!(prompt_text(""), None);
        assert!(!needs_trust(&fixture("caja-vacia.txt")));
    }

    #[test]
    fn reads_agy_notices() {
        let screen = format!(
            "> /voice\n  ⎿  No audio is being picked up. Check that your terminal app has microphone access: a blocked microphone can record\n     silence rather than failing.\n{RULE}\n>\n{RULE}\n? for shortcuts\n"
        );
        assert_eq!(
            notice(&screen).unwrap(),
            "No audio is being picked up. Check that your terminal app has microphone access: a blocked microphone can record silence rather than failing."
        );
        assert_eq!(notice(&fixture("caja-vacia.txt")), None);
    }

    #[test]
    fn audio_queue_paces_in_chunks_and_pads_with_silence() {
        let a = Audio::new();
        assert_eq!(a.next_chunk(), [0u8; CHUNK], "sin audio, silencio");
        a.push(&[7u8; 500]);
        assert_eq!(a.next_chunk(), [7u8; CHUNK]);
        let second = a.next_chunk();
        assert_eq!(&second[..180], &[7u8; 180][..]);
        assert_eq!(
            &second[180..],
            &[0u8; CHUNK - 180][..],
            "el resto, silencio"
        );
        assert_eq!(a.len(), 0);
        a.push(&vec![1u8; MAX_QUEUE + 1000]);
        assert_eq!(a.len(), MAX_QUEUE, "tope de audio pendiente");
        a.clear();
        assert_eq!(a.len(), 0);
    }
}
