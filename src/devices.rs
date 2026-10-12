//! Dispositivos emparejados (celulares, otras notebooks) y códigos de
//! emparejamiento de un solo uso.
//!
//! Un dispositivo nuevo se empareja con un código que genera `argos-board pair`
//! en el servidor: caduca a los pocos minutos, se destruye tras 5 intentos
//! fallidos o al usarse, y se canjea por un token propio del dispositivo (que se
//! puede revocar con `argos-board revoke`). Los archivos viven en el directorio
//! de configuración con permisos 0600; `serve` los relee en cada uso, así que
//! los comandos `pair` y `revoke` surten efecto sin reiniciarlo.

use crate::config;
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

/// Cuánto vive un código de emparejamiento.
pub const CODE_TTL_MINUTES: i64 = 5;
/// Intentos fallidos tras los cuales el código se destruye.
pub const MAX_FAILURES: u32 = 5;
/// Intentos de emparejamiento por minuto, sumando todos los orígenes.
const MAX_ATTEMPTS_PER_MINUTE: usize = 10;
/// Un dispositivo sin usar este tiempo deja de ser válido.
pub const IDLE_EXPIRY_DAYS: i64 = 30;
/// `last_seen` se reescribe como mucho una vez por este intervalo.
const TOUCH_EVERY_MINUTES: i64 = 60;
const MAX_NAME_CHARS: usize = 40;
/// Sin I, O, 0 ni 1 para que se pueda leer y teclear sin confundirlos. 32 símbolos.
const CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 8;

/// Comparación en tiempo constante respecto al contenido.
pub fn same_secret(given: &str, secret: &str) -> bool {
    given.len() == secret.len()
        && given
            .bytes()
            .zip(secret.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Device {
    /// Identificador corto para `revoke`.
    pub id: String,
    pub name: String,
    pub token: String,
    pub created_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
}

#[derive(Default, Serialize, Deserialize)]
struct DeviceFile {
    devices: Vec<Device>,
}

#[derive(Serialize, Deserialize)]
struct PendingCode {
    /// Normalizado (mayúsculas, sin guion).
    code: String,
    /// Distingue un código de otro para contar sus intentos fallidos.
    nonce: String,
    expires_at: DateTime<Utc>,
}

/// Nombre apto para mostrar: sin caracteres de control, recortado.
pub fn clean_name(raw: &str) -> String {
    let name: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    let name = name.trim();
    if name.is_empty() {
        "dispositivo".to_string()
    } else {
        name.to_string()
    }
}

/// Mayúsculas y solo letras/dígitos: `abcd-efgh` → `ABCDEFGH`.
pub fn normalize_code(s: &str) -> String {
    s.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// `ABCDEFGH` → `ABCD-EFGH`.
pub fn display_code(code: &str) -> String {
    let (a, b) = code.split_at(code.len() / 2);
    format!("{a}-{b}")
}

fn new_code() -> String {
    // 32 símbolos: un byte módulo 32 es uniforme.
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    bytes[..CODE_LEN]
        .iter()
        .map(|b| CODE_ALPHABET[usize::from(b % 32)] as char)
        .collect()
}

#[derive(Clone, Debug)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn open() -> Result<Self> {
        Ok(Self::new(config::config_dir()?))
    }

    fn devices_path(&self) -> PathBuf {
        self.dir.join("devices.json")
    }

    fn pairing_path(&self) -> PathBuf {
        self.dir.join("pairing.json")
    }

    fn load(&self) -> Result<DeviceFile> {
        match std::fs::read_to_string(self.devices_path()) {
            Ok(text) => serde_json::from_str(&text).context("devices.json inválido"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(DeviceFile::default()),
            Err(e) => Err(e).context("leyendo devices.json"),
        }
    }

    fn save(&self, file: &DeviceFile) -> Result<()> {
        std::fs::create_dir_all(&self.dir)
            .with_context(|| format!("creando {}", self.dir.display()))?;
        self.write_atomic(&self.devices_path(), &serde_json::to_string_pretty(file)?)
    }

    /// Lee, modifica y guarda `devices.json` bajo un cerrojo de archivo: `serve` (que renueva
    /// `last_seen`) y `argos-board pair|revoke` son procesos distintos, y sin cerrojo una
    /// escritura de uno podría deshacer la del otro (p. ej. una revocación).
    fn update<T>(&self, f: impl FnOnce(&mut DeviceFile) -> T) -> Result<T> {
        std::fs::create_dir_all(&self.dir)
            .with_context(|| format!("creando {}", self.dir.display()))?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.dir.join("devices.lock"))
            .context("abriendo devices.lock")?;
        lock.lock().context("bloqueando devices.lock")?;
        let mut file = self.load()?;
        let out = f(&mut file);
        self.save(&file)?;
        Ok(out) // el cerrojo se libera al cerrar `lock`
    }

    /// Escribe a un temporal y renombra, para que `serve` nunca lea un archivo a medias.
    fn write_atomic(&self, path: &std::path::Path, text: &str) -> Result<()> {
        let tmp = path.with_extension("tmp");
        config::write_private(&tmp, text)
            .with_context(|| format!("escribiendo {}", tmp.display()))?;
        std::fs::rename(&tmp, path).with_context(|| format!("escribiendo {}", path.display()))
    }

    pub fn list(&self) -> Result<Vec<Device>> {
        Ok(self.load()?.devices)
    }

    /// El dispositivo dueño de `token`, si sigue válido. Cualquier error de
    /// lectura cierra el acceso (devuelve `None`).
    pub fn authenticate(&self, token: &str, now: DateTime<Utc>) -> Option<Device> {
        if token.is_empty() {
            return None;
        }
        let device = self
            .load()
            .ok()?
            .devices
            .into_iter()
            .find(|d| same_secret(token, &d.token))?;
        self.renew(&device, now).then_some(device)
    }

    /// ¿Sigue vigente el dispositivo `id`? Renueva su `last_seen`. Lo usan las
    /// sesiones abiertas para cortarse cuando se revoca el dispositivo.
    pub fn touch(&self, id: &str, now: DateTime<Utc>) -> bool {
        let Ok(file) = self.load() else {
            return false;
        };
        file.devices
            .iter()
            .find(|d| d.id == id)
            .is_some_and(|d| self.renew(d, now))
    }

    /// `false` si el dispositivo caducó (y lo borra); si no, renueva `last_seen` como
    /// mucho una vez por hora.
    fn renew(&self, d: &Device, now: DateTime<Utc>) -> bool {
        if expired(d, now) {
            let _ = self.update(|f| f.devices.retain(|x| x.id != d.id));
            return false;
        }
        if now - d.last_seen > Duration::minutes(TOUCH_EVERY_MINUTES) {
            let _ = self.update(|f| {
                if let Some(x) = f.devices.iter_mut().find(|x| x.id == d.id) {
                    x.last_seen = now;
                }
            });
        }
        true
    }

    fn add(&self, name: &str, now: DateTime<Utc>) -> Result<Device> {
        let device = Device {
            id: uuid::Uuid::new_v4().simple().to_string()[..8].to_string(),
            name: clean_name(name),
            token: config::new_secret(),
            created_at: now,
            last_seen: now,
        };
        self.update(|f| f.devices.push(device.clone()))?;
        Ok(device)
    }

    /// Revoca por id (o prefijo de id) o por nombre. Devuelve los revocados.
    pub fn revoke(&self, key: &str) -> Result<Vec<Device>> {
        let key_lower = key.to_lowercase();
        self.update(|f| {
            let (gone, kept): (Vec<_>, Vec<_>) =
                std::mem::take(&mut f.devices).into_iter().partition(|d| {
                    d.id == key
                        || (key.len() >= 3 && d.id.starts_with(key))
                        || d.name.to_lowercase() == key_lower
                });
            f.devices = kept;
            gone
        })
    }

    pub fn revoke_all(&self) -> Result<Vec<Device>> {
        self.update(|f| std::mem::take(&mut f.devices))
    }

    /// Genera un código de emparejamiento nuevo (reemplaza al anterior).
    /// Devuelve el código para mostrar y cuándo caduca.
    pub fn create_code(&self, now: DateTime<Utc>) -> Result<(String, DateTime<Utc>)> {
        std::fs::create_dir_all(&self.dir)
            .with_context(|| format!("creando {}", self.dir.display()))?;
        let pending = PendingCode {
            code: new_code(),
            nonce: uuid::Uuid::new_v4().simple().to_string(),
            expires_at: now + Duration::minutes(CODE_TTL_MINUTES),
        };
        self.write_atomic(&self.pairing_path(), &serde_json::to_string(&pending)?)?;
        Ok((display_code(&pending.code), pending.expires_at))
    }

    fn pending(&self) -> Option<PendingCode> {
        serde_json::from_str(&std::fs::read_to_string(self.pairing_path()).ok()?).ok()
    }

    fn burn_code(&self) {
        let _ = std::fs::remove_file(self.pairing_path());
    }
}

fn expired(d: &Device, now: DateTime<Utc>) -> bool {
    now - d.last_seen > Duration::days(IDLE_EXPIRY_DAYS)
}

#[derive(Debug, PartialEq)]
pub enum PairError {
    /// No hay un código activo (hay que correr `argos-board pair`).
    NoCode,
    Expired,
    Wrong {
        remaining: u32,
    },
    /// Demasiados intentos fallidos: el código se destruyó.
    Exhausted,
    /// Demasiados intentos por minuto en total.
    TooMany,
    Storage,
}

impl PairError {
    pub fn message(&self) -> String {
        match self {
            Self::NoCode => "no hay un código activo: ejecuta `argos-board pair` en el servidor".into(),
            Self::Expired => "el código caducó: genera otro con `argos-board pair`".into(),
            Self::Wrong { remaining } => format!("código incorrecto ({remaining} intentos restantes)"),
            Self::Exhausted => {
                "demasiados intentos fallidos: el código se anuló, genera otro con `argos-board pair`".into()
            }
            Self::TooMany => "demasiados intentos; espera un minuto".into(),
            Self::Storage => "error interno del servidor".into(),
        }
    }
}

struct PairState {
    nonce: String,
    failures: u32,
    recent: VecDeque<Instant>,
}

/// Canje de códigos de emparejamiento por tokens de dispositivo. Una sola
/// instancia por servidor: su cerrojo serializa los intentos, así que dos
/// peticiones simultáneas no pueden saltarse el límite.
pub struct Pairing {
    store: Store,
    state: Mutex<PairState>,
}

impl Pairing {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            state: Mutex::new(PairState {
                nonce: String::new(),
                failures: 0,
                recent: VecDeque::new(),
            }),
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn try_pair(
        &self,
        given: &str,
        label: &str,
        now: DateTime<Utc>,
        at: Instant,
    ) -> Result<Device, PairError> {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while st
            .recent
            .front()
            .is_some_and(|t| at.duration_since(*t) >= std::time::Duration::from_secs(60))
        {
            st.recent.pop_front();
        }
        if st.recent.len() >= MAX_ATTEMPTS_PER_MINUTE {
            return Err(PairError::TooMany);
        }
        st.recent.push_back(at);

        let pending = self.store.pending().ok_or(PairError::NoCode)?;
        if now >= pending.expires_at {
            self.store.burn_code();
            return Err(PairError::Expired);
        }
        if st.nonce != pending.nonce {
            st.nonce = pending.nonce.clone();
            st.failures = 0;
        }
        if same_secret(&normalize_code(given), &pending.code) {
            self.store.burn_code();
            return self.store.add(label, now).map_err(|e| {
                tracing::error!("no se pudo guardar el dispositivo: {e:#}");
                PairError::Storage
            });
        }
        st.failures += 1;
        if st.failures >= MAX_FAILURES {
            self.store.burn_code();
            return Err(PairError::Exhausted);
        }
        Err(PairError::Wrong {
            remaining: MAX_FAILURES - st.failures,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::new(dir.path().to_path_buf());
        (dir, s)
    }

    fn code_of(s: &Store) -> String {
        s.pending().unwrap().code
    }

    #[test]
    fn codes_are_readable_and_normalized() {
        for _ in 0..50 {
            let c = new_code();
            assert_eq!(c.len(), CODE_LEN);
            assert!(c.bytes().all(|b| CODE_ALPHABET.contains(&b)), "{c}");
        }
        assert_eq!(display_code("ABCDEFGH"), "ABCD-EFGH");
        assert_eq!(normalize_code(" abcd-efgh "), "ABCDEFGH");
    }

    #[test]
    fn pair_creates_a_device_and_burns_the_code() {
        let (_d, s) = store();
        let p = Pairing::new(s.clone());
        let now = Utc::now();
        let (shown, _) = s.create_code(now).unwrap();
        let code = code_of(&s);
        assert_eq!(normalize_code(&shown), code);
        let dev = p
            .try_pair(&shown.to_lowercase(), "Pixel", now, Instant::now())
            .unwrap();
        assert_eq!(dev.name, "Pixel");
        assert_eq!(dev.token.len(), 64);
        assert_eq!(s.authenticate(&dev.token, now), Some(dev.clone()));
        // Un código se usa una sola vez.
        assert_eq!(
            p.try_pair(&code, "otro", now, Instant::now()),
            Err(PairError::NoCode)
        );
        assert_eq!(s.list().unwrap().len(), 1);
    }

    #[test]
    fn code_expires() {
        let (_d, s) = store();
        let p = Pairing::new(s.clone());
        let now = Utc::now();
        s.create_code(now).unwrap();
        let code = code_of(&s);
        let later = now + Duration::minutes(CODE_TTL_MINUTES) + Duration::seconds(1);
        assert_eq!(
            p.try_pair(&code, "x", later, Instant::now()),
            Err(PairError::Expired)
        );
        assert_eq!(
            p.try_pair(&code, "x", now, Instant::now()),
            Err(PairError::NoCode)
        );
    }

    #[test]
    fn code_is_burned_after_five_failures_even_if_guessed_later() {
        let (_d, s) = store();
        let p = Pairing::new(s.clone());
        let now = Utc::now();
        s.create_code(now).unwrap();
        let code = code_of(&s);
        for i in 1..MAX_FAILURES {
            assert_eq!(
                p.try_pair("AAAAAAAA", "x", now, Instant::now()),
                Err(PairError::Wrong {
                    remaining: MAX_FAILURES - i
                })
            );
        }
        assert_eq!(
            p.try_pair("AAAAAAAA", "x", now, Instant::now()),
            Err(PairError::Exhausted)
        );
        assert_eq!(
            p.try_pair(&code, "x", now, Instant::now()),
            Err(PairError::NoCode)
        );
        assert!(s.list().unwrap().is_empty());
        // Un código nuevo empieza con los intentos limpios.
        s.create_code(now).unwrap();
        assert_eq!(
            p.try_pair("AAAAAAAA", "x", now, Instant::now()),
            Err(PairError::Wrong {
                remaining: MAX_FAILURES - 1
            })
        );
    }

    #[test]
    fn attempts_per_minute_are_limited_across_codes() {
        let (_d, s) = store();
        let p = Pairing::new(s.clone());
        let now = Utc::now();
        let t0 = Instant::now();
        for _ in 0..MAX_ATTEMPTS_PER_MINUTE {
            s.create_code(now).unwrap(); // un código nuevo cada vez no reinicia el límite global
            let _ = p.try_pair("AAAAAAAA", "x", now, t0);
        }
        assert_eq!(
            p.try_pair("AAAAAAAA", "x", now, t0),
            Err(PairError::TooMany)
        );
        let later = t0 + std::time::Duration::from_secs(61);
        assert_ne!(
            p.try_pair("AAAAAAAA", "x", now, later),
            Err(PairError::TooMany)
        );
    }

    #[test]
    fn revoke_by_id_prefix_and_name() {
        let (_d, s) = store();
        let now = Utc::now();
        let a = s.add("Celular", now).unwrap();
        let b = s.add("Notebook", now).unwrap();
        assert!(s.revoke("zz").unwrap().is_empty());
        assert_eq!(s.revoke(&a.id[..4]).unwrap().len(), 1);
        assert_eq!(s.authenticate(&a.token, now), None);
        assert!(s.authenticate(&b.token, now).is_some());
        assert_eq!(s.revoke("notebook").unwrap().len(), 1);
        assert!(s.list().unwrap().is_empty());
        s.add("x", now).unwrap();
        assert_eq!(s.revoke_all().unwrap().len(), 1);
    }

    #[test]
    fn idle_devices_expire_and_use_renews() {
        let (_d, s) = store();
        let t0 = Utc::now();
        let d = s.add("Celular", t0).unwrap();
        let t1 = t0 + Duration::days(IDLE_EXPIRY_DAYS - 1);
        assert!(s.authenticate(&d.token, t1).is_some());
        // El uso renovó last_seen: sigue válido otros 29 días después.
        let t2 = t1 + Duration::days(IDLE_EXPIRY_DAYS - 1);
        assert!(s.touch(&d.id, t2));
        let t3 = t2 + Duration::days(IDLE_EXPIRY_DAYS + 1);
        assert_eq!(s.authenticate(&d.token, t3), None);
        assert!(s.list().unwrap().is_empty());
        assert!(!s.touch(&d.id, t3));
    }

    #[test]
    fn broken_or_missing_files_deny_access() {
        let (dir, s) = store();
        assert_eq!(s.authenticate("x", Utc::now()), None);
        assert_eq!(s.authenticate("", Utc::now()), None);
        std::fs::write(dir.path().join("devices.json"), "{no es json").unwrap();
        assert_eq!(s.authenticate("x", Utc::now()), None);
        assert!(s.list().is_err());
        assert!(!s.touch("x", Utc::now()));
    }

    #[test]
    fn concurrent_writers_do_not_lose_updates() {
        let (_d, s) = store();
        let now = Utc::now();
        let handles: Vec<_> = (0..16)
            .map(|i| {
                let s = s.clone();
                std::thread::spawn(move || s.add(&format!("d{i}"), now).unwrap())
            })
            .collect();
        let added: Vec<Device> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(s.list().unwrap().len(), 16);
        // Revocar y renovar a la vez: lo revocado no reaparece.
        let victim = added[0].clone();
        let renewers: Vec<_> = (0..8)
            .map(|_| {
                let s = s.clone();
                let token = added[1].token.clone();
                std::thread::spawn(move || {
                    let later = now + Duration::minutes(TOUCH_EVERY_MINUTES + 1);
                    s.authenticate(&token, later)
                })
            })
            .collect();
        s.revoke(&victim.id).unwrap();
        for r in renewers {
            r.join().unwrap();
        }
        let left = s.list().unwrap();
        assert_eq!(left.len(), 15);
        assert!(left.iter().all(|d| d.id != victim.id));
    }

    #[test]
    fn names_are_sanitized() {
        assert_eq!(clean_name("  \u{1b}[31mPixel\n "), "[31mPixel");
        assert_eq!(clean_name(""), "dispositivo");
        assert_eq!(clean_name(&"a".repeat(100)).len(), MAX_NAME_CHARS);
    }

    #[cfg(unix)]
    #[test]
    fn files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, s) = store();
        s.add("x", Utc::now()).unwrap();
        s.create_code(Utc::now()).unwrap();
        for f in ["devices.json", "pairing.json"] {
            let mode = std::fs::metadata(dir.path().join(f))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "{f}");
        }
    }
}
