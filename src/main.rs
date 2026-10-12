mod config;
mod devices;
mod git;
mod model;
mod profiles;
mod redact;
mod server;
mod wrapper;

use clap::{Parser, Subcommand};
use std::net::IpAddr;
use std::path::PathBuf;

/// Versión + commit del build, p. ej. `0.1.0 (abe63f4)`.
pub const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (", env!("ARGOS_BUILD"), ")");

#[derive(Parser)]
#[command(
    name = "argos-board",
    version = VERSION,
    about = "Tablero web local para ver agentes de código CLI trabajando"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Inicia el servidor web (por defecto solo 127.0.0.1).
    Serve {
        #[arg(long, default_value_t = config::DEFAULT_PORT)]
        port: u16,
        /// Además de 127.0.0.1, escucha en esta IP privada (p. ej. la de WireGuard o la
        /// del Wi-Fi de casa). Se puede repetir. Los demás dispositivos se emparejan con
        /// `argos-board pair`. No admite 0.0.0.0 ni IPs públicas.
        #[arg(long, value_name = "IP", value_delimiter = ',')]
        bind: Vec<IpAddr>,
        /// Nombre extra con el que se accede (p. ej. `servidor.local`); se suma a las
        /// IPs de --bind como `Host` permitido.
        #[arg(long, value_name = "HOST")]
        allow_host: Vec<String>,
    },
    /// Genera un código de un solo uso para emparejar un dispositivo (celular, otra notebook).
    Pair,
    /// Lista los dispositivos emparejados.
    Devices,
    /// Revoca un dispositivo (por id o nombre), o todos con --all.
    Revoke {
        /// Id (o prefijo de al menos 3 caracteres) o nombre; mira `argos-board devices`.
        target: Option<String>,
        #[arg(long, conflicts_with = "target")]
        all: bool,
    },
    /// Ejecuta un agente dentro de un PTY y lo reporta al servidor.
    Run {
        /// Nombre de la tarjeta (por defecto `<binario>@<carpeta>`).
        #[arg(long)]
        name: Option<String>,
        /// Proyecto a mostrar (por defecto el directorio actual).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Puerto del servidor.
        #[arg(long, default_value_t = config::DEFAULT_PORT)]
        port: u16,
        /// Guarda la pantalla en DIR en cada cambio de estado (para calibrar patrones).
        #[arg(long, value_name = "DIR")]
        dump_screens: Option<PathBuf>,
        /// No aceptar entrada desde la página (por defecto se acepta).
        #[arg(long)]
        no_input: bool,
        /// Comando del agente, después de `--`.
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Serve {
            port,
            bind,
            allow_host,
        } => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "argos_board=info".into()),
                )
                .with_writer(std::io::stderr)
                .init();
            let rt = tokio::runtime::Runtime::new().expect("runtime tokio");
            if let Err(e) = rt.block_on(server::serve(port, bind, allow_host)) {
                eprintln!("error: {e:#}");
                std::process::exit(1);
            }
        }
        Cmd::Pair => exit_on_error(cmd_pair()),
        Cmd::Devices => exit_on_error(cmd_devices()),
        Cmd::Revoke { target, all } => exit_on_error(cmd_revoke(target, all)),
        Cmd::Run {
            name,
            project,
            port,
            dump_screens,
            no_input,
            command,
        } => {
            // El wrapper nunca escribe logs en la terminal del agente; solo a un
            // archivo si se pide con ARGOS_BOARD_LOG=<ruta>.
            init_wrapper_log();
            let opts = wrapper::RunOptions {
                name,
                project,
                port,
                dump_screens,
                no_input,
                command,
            };
            match wrapper::run(opts) {
                Ok(code) => std::process::exit(code),
                Err(e) => {
                    eprintln!("argos-board: {e:#}");
                    std::process::exit(127);
                }
            }
        }
    }
}

/// Log del wrapper a un archivo (`ARGOS_BOARD_LOG=<ruta>`), para depurar sin
/// tocar la terminal. Nivel con `RUST_LOG` (por defecto `argos_board=debug`).
fn init_wrapper_log() {
    let Some(path) = std::env::var_os("ARGOS_BOARD_LOG") else {
        return;
    };
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(file) => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "argos_board=debug".into()),
                )
                .with_writer(std::sync::Mutex::new(file))
                .with_ansi(false)
                .init();
        }
        Err(e) => eprintln!(
            "argos-board: no se pudo abrir ARGOS_BOARD_LOG ({}): {e}",
            path.to_string_lossy()
        ),
    }
}

fn exit_on_error(result: anyhow::Result<()>) {
    if let Err(e) = result {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

fn cmd_pair() -> anyhow::Result<()> {
    let (code, _) = devices::Store::open()?.create_code(chrono::Utc::now())?;
    println!("Código de emparejamiento:  {code}");
    println!(
        "Caduca en {} minutos, sirve una sola vez y se anula tras {} intentos fallidos.",
        devices::CODE_TTL_MINUTES,
        devices::MAX_FAILURES
    );
    println!(
        "En el dispositivo, abre la dirección del servidor (la que imprime `serve`) e ingresa el código."
    );
    Ok(())
}

fn cmd_devices() -> anyhow::Result<()> {
    let list = devices::Store::open()?.list()?;
    if list.is_empty() {
        println!("No hay dispositivos emparejados. Crea un código con `argos-board pair`.");
        return Ok(());
    }
    println!(
        "{:<10} {:<24} {:<18} Visto por última vez",
        "ID", "Nombre", "Emparejado"
    );
    for d in list {
        println!(
            "{:<10} {:<24} {:<18} {}",
            d.id,
            d.name,
            d.created_at
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M"),
            d.last_seen
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M"),
        );
    }
    Ok(())
}

fn cmd_revoke(target: Option<String>, all: bool) -> anyhow::Result<()> {
    let store = devices::Store::open()?;
    let gone = match (target, all) {
        (_, true) => store.revoke_all()?,
        (Some(t), false) => store.revoke(&t)?,
        (None, false) => {
            anyhow::bail!("indica un id o nombre (mira `argos-board devices`), o usa --all")
        }
    };
    if gone.is_empty() {
        anyhow::bail!("ningún dispositivo coincide (mira `argos-board devices`)");
    }
    for d in &gone {
        println!("Revocado: {} ({})", d.name, d.id);
    }
    println!("Las sesiones abiertas de esos dispositivos se cierran en unos segundos.");
    Ok(())
}
