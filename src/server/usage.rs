//! Consumo de cada agente: se le pregunta a los propios CLI (`claude -p "/usage"`, `agy -p "/usage"`,
//! `opencode stats`), nunca a otro servidor. Se consulta solo cuando una página lo pide, y lo último que
//! se supo se reutiliza unos minutos, así que con la página cerrada no corre ningún comando.

use crate::model::{AgentKind, AgentUsage, Fact, Meter, UsageReport};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

/// Lo último que se supo sigue valiendo este tiempo.
pub const TTL: Duration = Duration::from_secs(5 * 60);
/// Aun pidiendo actualizar, no se consulta más seguido que esto.
pub const MIN_GAP: Duration = Duration::from_secs(20);
/// Tiempo máximo de cada comando (los CLI tardan en arrancar).
const PROBE_TIMEOUT: Duration = Duration::from_secs(40);
/// Tope de lo que se lee de un comando.
const MAX_OUTPUT: usize = 64 * 1024;

/// Agentes que informan consumo y el comando que lo dice.
const PROBES: &[(AgentKind, &str, &[&str])] = &[
    (AgentKind::Claude, "claude", &["-p", "/usage"]),
    (AgentKind::Agy, "agy", &["-p", "/usage"]),
    (AgentKind::Opencode, "opencode", &["stats"]),
];

struct Cache {
    at: Option<Instant>,
    report: Option<UsageReport>,
}

pub struct UsageHub {
    /// Carpeta donde corren los comandos: una neutra, para que no queden sesiones sueltas en los proyectos.
    dir: PathBuf,
    disabled: bool,
    /// Se mantiene tomada mientras se consulta, así varias páginas comparten una sola consulta.
    cache: Mutex<Cache>,
}

impl UsageHub {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            disabled: std::env::var_os("ARGOS_BOARD_NO_USAGE").is_some(),
            cache: Mutex::new(Cache {
                at: None,
                report: None,
            }),
        }
    }

    /// ¿Hay algo que consultar? (no está desactivado y hay alguno de esos CLI instalado)
    pub fn available(&self) -> bool {
        !self.disabled && PROBES.iter().any(|(_, bin, _)| find_in_path(bin).is_some())
    }

    /// Lo último que se supo, o una consulta nueva si ya venció (o si se pidió actualizar y pasó `MIN_GAP`).
    pub async fn report(&self, refresh: bool) -> Option<UsageReport> {
        if !self.available() {
            return None;
        }
        let mut cache = self.cache.lock().await;
        let age = cache.at.map(|t| t.elapsed());
        let fresh = age.is_some_and(|a| a < if refresh { MIN_GAP } else { TTL });
        if !fresh {
            let report = collect(&self.dir).await;
            cache.at = Some(Instant::now());
            cache.report = Some(report);
        }
        cache.report.clone()
    }
}

/// Busca un ejecutable en el PATH de `serve` (el que heredan los agentes).
fn find_in_path(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(bin))
        .find(|p| p.is_file())
}

async fn collect(dir: &Path) -> UsageReport {
    let _ = std::fs::create_dir_all(dir);
    let probes = PROBES
        .iter()
        .filter(|(_, bin, _)| find_in_path(bin).is_some())
        .map(|(kind, bin, args)| probe(*kind, bin, args, dir));
    UsageReport {
        at: Utc::now(),
        agents: futures_util::future::join_all(probes).await,
    }
}

async fn probe(kind: AgentKind, bin: &str, args: &[&str], dir: &Path) -> AgentUsage {
    let empty = |error| AgentUsage {
        kind,
        meters: Vec::new(),
        facts: Vec::new(),
        error: Some(error),
    };
    let out = match run(bin, args, dir).await {
        Ok(out) => out,
        Err(error) => return empty(error),
    };
    let (meters, facts) = match kind {
        AgentKind::Claude => (parse_claude(&out), Vec::new()),
        AgentKind::Agy => (parse_agy(&out), Vec::new()),
        AgentKind::Opencode => (Vec::new(), parse_opencode(&out)),
        _ => (Vec::new(), Vec::new()),
    };
    if meters.is_empty() && facts.is_empty() {
        return empty("no_data");
    }
    AgentUsage {
        kind,
        meters,
        facts,
        error: None,
    }
}

/// Corre un comando con tiempo límite y devuelve lo que escribió (sin escapes de color).
async fn run(bin: &str, args: &[&str], dir: &Path) -> Result<String, &'static str> {
    let mut child = Command::new(bin)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "failed")?;
    let mut stdout = child.stdout.take().ok_or("failed")?;
    let read = async {
        let mut buf = Vec::new();
        let _ = (&mut stdout)
            .take(MAX_OUTPUT as u64)
            .read_to_end(&mut buf)
            .await;
        let _ = child.wait().await;
        buf
    };
    let buf = tokio::time::timeout(PROBE_TIMEOUT, read)
        .await
        .map_err(|_| "timeout")?;
    Ok(crate::wrapper::screen::strip_ansi(
        &String::from_utf8_lossy(&buf),
    ))
}

/// `Current session: 34% used · resets Oct 14, 11:49pm (America/Santiago)` y la de la semana
/// (con un paréntesis si es de un modelo, p. ej. `Current week (Opus): 10% used`).
pub fn parse_claude(out: &str) -> Vec<Meter> {
    let mut meters = Vec::new();
    for line in out.lines() {
        let Some(rest) = line.trim().strip_prefix("Current ") else {
            continue;
        };
        let Some((head, tail)) = rest.split_once(':') else {
            continue;
        };
        let (id, label) = match head.split_once(" (") {
            Some((id, label)) => (id, Some(label.trim_end_matches(')').to_string())),
            None => (head, None),
        };
        let id = match id.trim() {
            "session" => "session",
            "week" => "week",
            _ => continue,
        };
        let Some(pct) = percent_before(tail, "used") else {
            continue;
        };
        // «all models» es el límite general: no necesita etiqueta.
        let label = label.filter(|l| !l.eq_ignore_ascii_case("all models"));
        let resets = tail
            .split_once("resets")
            .map(|(_, r)| r.trim().to_string())
            .filter(|r| !r.is_empty());
        meters.push(Meter {
            id: id.into(),
            label,
            used_pct: pct,
            resets,
        });
    }
    meters
}

/// El número de `34% used`: el porcentaje que está justo antes de la palabra `word`.
fn percent_before(text: &str, word: &str) -> Option<f32> {
    let idx = text.find(word)?;
    let before = text[..idx].trim_end();
    let pct = before.strip_suffix('%')?;
    let start = pct
        .rfind(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map_or(0, |i| i + 1);
    pct[start..].parse().ok()
}

/// Filas con tabuladores: familia, límite, porcentaje que **queda** y cuándo se reinicia. De cada
/// límite se toma la familia más gastada, y se invierte para mostrar lo usado como los demás.
pub fn parse_agy(out: &str) -> Vec<Meter> {
    let mut best: Vec<Meter> = Vec::new();
    for line in out.lines() {
        let cols: Vec<&str> = line.split('\t').map(str::trim).collect();
        if cols.len() < 3 {
            continue;
        }
        let kind = cols[1].to_ascii_lowercase();
        let id = if kind.contains("weekly") {
            "week"
        } else if kind.contains("five hour") || kind.contains("5 hour") {
            "five_hour"
        } else {
            continue;
        };
        let Ok(left) = cols[2].trim_end_matches('%').parse::<f32>() else {
            continue;
        };
        let meter = Meter {
            id: id.into(),
            label: Some(cols[0].to_string()).filter(|l| !l.is_empty()),
            used_pct: (100.0 - left).clamp(0.0, 100.0),
            resets: cols.get(3).map(|r| r.to_string()).filter(|r| !r.is_empty()),
        };
        match best.iter_mut().find(|m| m.id == meter.id) {
            Some(m) if m.used_pct >= meter.used_pct => {}
            Some(m) => *m = meter,
            None => best.push(meter),
        }
    }
    best
}

/// El costo total y las sesiones de `opencode stats` (tablas con bordes `│`).
pub fn parse_opencode(out: &str) -> Vec<Fact> {
    let value_of = |label: &str| {
        out.lines().find_map(|l| {
            let l = l.trim().trim_matches('│').trim();
            let rest = l.strip_prefix(label)?;
            let v = rest.trim();
            (!v.is_empty() && !v.contains(' ')).then(|| v.to_string())
        })
    };
    let mut facts = Vec::new();
    if let Some(v) = value_of("Total Cost") {
        facts.push(Fact {
            id: "cost".into(),
            value: v,
        });
    }
    if let Some(v) = value_of("Sessions") {
        facts.push(Fact {
            id: "sessions".into(),
            value: v,
        });
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: &str = "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 34% used · resets Oct 14, 11:49pm (America/Santiago)\nCurrent week (all models): 25% used · resets Oct 19, 11:59am (America/Santiago)\nCurrent week (Opus): 7.5% used · resets Oct 19, 11:59am (America/Santiago)\n\nWhat's contributing to your limits usage?\nApproximate, based on local sessions on this machine\n";

    const AGY: &str = "Gemini Models\tWeekly Limit Remaining\t61%\t2026-10-18T01:12:18Z\nGemini Models\tFive Hour Limit Remaining\t100%\t2026-10-15T04:05:15Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-21T23:05:15Z\nClaude and GPT models\tFive Hour Limit Remaining\t100%\t2026-10-15T04:05:15Z\n";

    const OPENCODE: &str = "┌──────┐\n│                       OVERVIEW                         │\n├──────┤\n│Sessions                                             26 │\n│Messages                                            810 │\n└──────┘\n\n┌──────┐\n│                    COST & TOKENS                       │\n├──────┤\n│Total Cost                                        $1.33 │\n│Avg Cost/Day                                      $0.05 │\n└──────┘\n";

    #[test]
    fn claude_reports_session_and_week_with_their_reset() {
        let m = parse_claude(CLAUDE);
        assert_eq!(m.len(), 3);
        assert_eq!(
            (m[0].id.as_str(), m[0].used_pct, m[0].label.as_deref()),
            ("session", 34.0, None)
        );
        assert_eq!(
            m[0].resets.as_deref(),
            Some("Oct 14, 11:49pm (America/Santiago)")
        );
        assert_eq!(
            (m[1].id.as_str(), m[1].used_pct, m[1].label.as_deref()),
            ("week", 25.0, None),
            "«all models» no lleva etiqueta"
        );
        assert_eq!(
            (m[2].id.as_str(), m[2].used_pct, m[2].label.as_deref()),
            ("week", 7.5, Some("Opus"))
        );
        assert!(parse_claude("nada que ver\nCurrent folder: 3% used").is_empty());
    }

    #[test]
    fn agy_keeps_the_most_used_family_of_each_limit_and_inverts_remaining() {
        let m = parse_agy(AGY);
        assert_eq!(m.len(), 2);
        let week = m.iter().find(|x| x.id == "week").unwrap();
        assert_eq!(week.used_pct, 39.0);
        assert_eq!(week.label.as_deref(), Some("Gemini Models"));
        assert_eq!(week.resets.as_deref(), Some("2026-10-18T01:12:18Z"));
        let five = m.iter().find(|x| x.id == "five_hour").unwrap();
        assert_eq!(five.used_pct, 0.0);
        assert!(parse_agy("sin tabuladores\nuna sola columna\n").is_empty());
    }

    #[test]
    fn opencode_reports_total_cost_and_sessions() {
        let f = parse_opencode(OPENCODE);
        assert_eq!(f.len(), 2);
        assert_eq!((f[0].id.as_str(), f[0].value.as_str()), ("cost", "$1.33"));
        assert_eq!((f[1].id.as_str(), f[1].value.as_str()), ("sessions", "26"));
        assert!(parse_opencode("nada").is_empty());
    }

    #[test]
    fn percent_is_read_next_to_the_word() {
        assert_eq!(percent_before(" 34% used · resets", "used"), Some(34.0));
        assert_eq!(percent_before(" 7.5% used", "used"), Some(7.5));
        assert_eq!(percent_before(" mucho used", "used"), None);
    }

    #[tokio::test]
    async fn a_missing_command_is_an_error_and_a_present_one_returns_its_output() {
        let dir = std::env::temp_dir();
        assert_eq!(run("argos-board-no-existe", &[], &dir).await, Err("failed"));
        let out = run("sh", &["-c", "printf 'hola\\n'"], &dir).await.unwrap();
        assert_eq!(out.trim(), "hola");
    }
}
