//! `--dump-screens`: guarda la pantalla en cada cambio de estado para
//! calibrar los patrones de cada agente con sesiones reales.

use chrono::Utc;
use std::path::PathBuf;

pub struct Dumper {
    dir: PathBuf,
    seq: u32,
    header: String,
}

impl Dumper {
    pub fn new(dir: PathBuf, name: &str, kind: &str) -> std::io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            dir,
            seq: 0,
            header: format!("agent: {name}\nkind: {kind}\n"),
        })
    }

    /// Escribe `<timestamp>-<seq>-<etiqueta>.txt`. Los errores se ignoran: el
    /// wrapper no puede ensuciar la terminal del agente.
    pub fn dump(&mut self, label: &str, size: (u16, u16), contents: &str) {
        self.seq += 1;
        let now = Utc::now();
        let file = self.dir.join(format!(
            "{}-{:04}-{label}.txt",
            now.format("%Y%m%d-%H%M%S%.3f"),
            self.seq
        ));
        let body = format!(
            "{}state: {label}\nat: {}\nsize: {}x{}\n---\n{contents}\n",
            self.header,
            now.to_rfc3339(),
            size.0,
            size.1
        );
        let _ = std::fs::write(file, body);
    }
}
