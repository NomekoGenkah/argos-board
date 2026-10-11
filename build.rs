//! Identificador de build: commit corto de git (+ "-dirty" con cambios sin
//! commit). Así se distinguen dos binarios con la misma versión de Cargo.toml.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    let build = match git(&["rev-parse", "--short", "HEAD"]) {
        Some(hash) => {
            let dirty = git(&["status", "--porcelain", "--untracked-files=no"])
                .is_some_and(|s| !s.is_empty());
            if dirty { format!("{hash}-dirty") } else { hash }
        }
        None => "sin-git".to_string(),
    };
    println!("cargo:rustc-env=ARGOS_BUILD={build}");
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/index");
    println!("cargo:rerun-if-changed=.git/refs");
}
