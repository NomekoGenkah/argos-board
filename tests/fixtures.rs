//! Valida el formato de las pantallas grabadas en tests/fixtures/screens.

use std::path::Path;

const AGENTS: &[&str] = &["claude", "opencode", "agy"];
const CATEGORIES: &[&str] = &["pregunta", "permiso", "confianza", "fin_de_turno"];

#[test]
fn screen_fixtures_are_well_formed() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/screens");
    let mut count = 0;
    for agent in AGENTS {
        for entry in std::fs::read_dir(root.join(agent)).unwrap() {
            let path = entry.unwrap().path();
            let text = std::fs::read_to_string(&path).unwrap();
            let (head, body) = text
                .split_once("\n---\n")
                .unwrap_or_else(|| panic!("{path:?}: falta '---'"));
            let field = |k: &str| {
                head.lines()
                    .find_map(|l| l.strip_prefix(&format!("# {k}: ")))
                    .unwrap_or_else(|| panic!("{path:?}: falta '# {k}:'"))
            };
            assert_eq!(field("agente"), *agent, "{path:?}");
            assert!(CATEGORIES.contains(&field("categoria")), "{path:?}");
            field("descripcion");
            assert!(!body.trim().is_empty(), "{path:?}: pantalla vacía");
            count += 1;
        }
    }
    assert!(count >= 10, "solo {count} fixtures");
}
