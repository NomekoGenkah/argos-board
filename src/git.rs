//! Rama git del proyecto: nombre de rama, hash corto si HEAD está detached,
//! o cadena vacía si la carpeta no es un repo.

use std::path::Path;
use std::process::{Command, Stdio};

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

pub fn current_branch(dir: &Path) -> String {
    match git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Some(b) if b == "HEAD" => git(dir, &["rev-parse", "--short", "HEAD"]).unwrap_or_default(),
        Some(b) => b,
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .unwrap()
            .status
            .success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn no_repo_is_empty() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(current_branch(d.path()), "");
    }

    #[test]
    fn branch_and_detached() {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["init", "-q", "-b", "trunk"]);
        run(d.path(), &["commit", "-q", "--allow-empty", "-m", "x"]);
        assert_eq!(current_branch(d.path()), "trunk");
        run(d.path(), &["checkout", "-q", "--detach"]);
        let short = current_branch(d.path());
        assert!(
            short.len() >= 7 && short.chars().all(|c| c.is_ascii_hexdigit()),
            "{short}"
        );
    }
}
