mod config;
mod git;
mod model;
mod profiles;
mod redact;
mod server;
mod wrapper;

use clap::{Parser, Subcommand};
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
    /// Inicia el servidor web (solo 127.0.0.1).
    Serve {
        #[arg(long, default_value_t = config::DEFAULT_PORT)]
        port: u16,
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
        /// Comando del agente, después de `--`.
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Serve { port } => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "argos_board=info".into()),
                )
                .with_writer(std::io::stderr)
                .init();
            let rt = tokio::runtime::Runtime::new().expect("runtime tokio");
            if let Err(e) = rt.block_on(server::serve(port)) {
                eprintln!("error: {e:#}");
                std::process::exit(1);
            }
        }
        Cmd::Run {
            name,
            project,
            port,
            dump_screens,
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
