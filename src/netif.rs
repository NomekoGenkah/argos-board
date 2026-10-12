//! Direcciones de red de esta máquina: las IPs privadas en las que `serve` ofrece el tablero.

use std::net::IpAddr;

/// Interfaces virtuales de contenedores y máquinas virtuales: el celular no llega por ahí.
fn is_virtual_interface(name: &str) -> bool {
    [
        "docker", "br-", "veth", "virbr", "vmnet", "vboxnet", "cni", "flannel", "lxcbr",
    ]
    .iter()
    .any(|p| name.starts_with(p))
}

/// IPv4 privadas de las interfaces activas (sin loopback ni virtuales): `(interfaz, ip)`.
/// Cubre la LAN (eth0, wlan0) y túneles como WireGuard (wg0).
#[cfg(unix)]
pub fn private_interfaces() -> Vec<(String, IpAddr)> {
    use std::ffi::CStr;
    use std::net::Ipv4Addr;

    let mut out: Vec<(String, IpAddr)> = Vec::new();
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs rellena una lista enlazada que se recorre solo mientras no se
    // libera con freeifaddrs; cada puntero se comprueba antes de usarlo.
    unsafe {
        if libc::getifaddrs(&mut head) != 0 {
            return out;
        }
        let mut cur = head;
        while !cur.is_null() {
            let ifa = &*cur;
            cur = ifa.ifa_next;
            let flags = ifa.ifa_flags;
            let usable = flags & libc::IFF_UP as libc::c_uint != 0
                && flags & libc::IFF_LOOPBACK as libc::c_uint == 0;
            if !usable
                || ifa.ifa_addr.is_null()
                || i32::from((*ifa.ifa_addr).sa_family) != libc::AF_INET
            {
                continue;
            }
            let sin = &*(ifa.ifa_addr as *const libc::sockaddr_in);
            let ip = IpAddr::V4(Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr)));
            let name = CStr::from_ptr(ifa.ifa_name).to_string_lossy().into_owned();
            if crate::server::is_private_ip(ip)
                && !is_virtual_interface(&name)
                && !out.iter().any(|(_, known)| *known == ip)
            {
                out.push((name, ip));
            }
        }
        libc::freeifaddrs(head);
    }
    out
}

#[cfg(not(unix))]
pub fn private_interfaces() -> Vec<(String, IpAddr)> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_interfaces_are_skipped() {
        for name in ["docker0", "br-1a2b3c", "veth12ab", "virbr0", "cni0"] {
            assert!(is_virtual_interface(name), "{name}");
        }
        for name in ["eth0", "wlan0", "wg0", "enp3s0", "tailscale0"] {
            assert!(!is_virtual_interface(name), "{name}");
        }
    }

    #[test]
    fn found_addresses_are_private_and_not_loopback() {
        for (name, ip) in private_interfaces() {
            assert!(crate::server::is_private_ip(ip), "{name} {ip}");
            assert!(!ip.is_loopback(), "{name} {ip}");
        }
    }
}
