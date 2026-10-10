//! Redacción básica de secretos antes de que `last_lines` salga del wrapper.

use regex::Regex;
use std::sync::LazyLock;

static PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        // Claves tipo sk-..., sk-ant-..., sk-proj-...
        (Regex::new(r"\bsk-[A-Za-z0-9_\-]{8,}").unwrap(), "sk-[REDACTED]"),
        // Cabeceras Authorization: Bearer <token>
        (Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=\-]+").unwrap(), "Bearer [REDACTED]"),
        // Variables FOO_KEY=..., FOO_TOKEN=..., FOO_SECRET=..., FOO_PASSWORD=...
        (
            Regex::new(r#"(?i)\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)"#)
                .unwrap(),
            "${1}${2}[REDACTED]",
        ),
    ]
});

pub fn redact(line: &str) -> String {
    let mut out = line.to_string();
    for (re, rep) in PATTERNS.iter() {
        if re.is_match(&out) {
            out = re.replace_all(&out, *rep).into_owned();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_sk_keys() {
        assert_eq!(
            redact("key is sk-ant-abc123DEF456xyz"),
            "key is sk-[REDACTED]"
        );
    }

    #[test]
    fn redacts_bearer() {
        assert_eq!(
            redact("Authorization: Bearer eyJhbGciOi.abc-def"),
            "Authorization: Bearer [REDACTED]"
        );
    }

    #[test]
    fn redacts_env_assignments() {
        assert_eq!(
            redact("export OPENAI_API_KEY=abc123"),
            "export OPENAI_API_KEY=[REDACTED]"
        );
        assert_eq!(
            redact("GITHUB_TOKEN = \"x y z\""),
            "GITHUB_TOKEN = [REDACTED]"
        );
        assert_eq!(redact("db_password: hunter2"), "db_password: [REDACTED]");
    }

    #[test]
    fn leaves_normal_text() {
        let s = "Compiling argos-board v0.1.0 (task: keyboard)";
        assert_eq!(redact(s), s);
    }
}
