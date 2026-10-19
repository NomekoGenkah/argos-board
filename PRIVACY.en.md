# Privacy policy

[Español](PRIVACY.md) · [README](README.md)

Argos Board is a program that runs on your own machine. It has no accounts, no server of its own, and it collects
no telemetry, usage statistics or crash reports. This page says exactly what it stores, what it sends, and how to
delete it. If something in the program does not match it, that is a bug: please open an issue.

## What runs, and where

- `argos-board serve` is a web server that listens on `127.0.0.1` and, unless you use `--local-only` or `--bind`, on
  the machine's private networks (LAN, WireGuard, Tailscale) so you can open the board from your phone. From the
  network nothing is visible until the device is paired with a one-time code.
- `argos-board run` wraps an agent in a terminal and tells the server what its screen shows.
- The page you open in the browser ships inside the program: it loads no fonts, scripts or images from other sites.

## What it stores on your machine

| Where | What | Why |
|---|---|---|
| `~/.config/argos-board/token` and `control-token` | Two random secrets (permissions `0600`) | So only your wrappers send data and only your browser writes to the agents |
| `~/.config/argos-board/devices.json` | For each paired device: an id, a short name (e.g. "Android · Chrome"), its token, and creation and last-use dates | To recognize your phone. A device unused for 30 days stops being valid; `argos-board revoke` removes it sooner |
| `~/.config/argos-board/voice/` and `usage-probe/` | Empty working folders | The voice dictation one, and the one usage is queried from, so your projects stay clean |
| `<project>/.argos/uploads/` | Files you attach from the page, and a `.gitignore` that excludes them from git | So the agent can read them |
| The folder you give `--dump-screens` | Agent screens | Only if you ask, to calibrate detection |
| The file in `ARGOS_BOARD_LOG` | The wrapper's log (without what you type or what is shown) | Only if you ask, for debugging |

**Agent output is never written to disk.** It lives in the server's memory while the card is on view and is
deleted 10 minutes after the agent finishes. What you type in the page is not written to any log either.

## What your browser stores

Only in your browser (`localStorage`, no cookies), and it never leaves it:

- Preferences: style, theme, layout, density, corners, presets, language, motion, terminal, sound, dictation
  language, view (Board or Office), whether usage is shown, each card's position and size, each agent's desk in the
  Office, and which cards you dismissed.
- Access permissions: the token from `serve`'s link (if you opened it) and this device's token (if you paired it).
- A per-tab "already notified about this" marker (`sessionStorage`), to avoid repeating notifications.

To delete everything: "Clear site data" in your browser's settings.

## What is sent, and to whom

**To Argos Board: nothing.** There is no Argos Board server to send anything to. The program itself makes no
outbound network calls. The following are done by other pieces, only when you use the feature:

- **Each agent's usage.** With the option on (Settings), the server runs `claude -p "/usage"`, `agy -p "/usage"`
  and `opencode stats` for the agents you have installed, from a neutral folder, at most every 5 minutes and only
  while a page is open. Those programs query their own providers (Anthropic, Google) with your credentials, just as
  if you ran them yourself; Argos Board only reads the answer. Turn it off in Settings or with
  `ARGOS_BOARD_NO_USAGE=1`.
- **The agents you launch or wrap** (Claude Code, OpenCode, Antigravity, Copilot) talk to their providers under
  each one's terms. Argos Board does not read or forward that traffic.
- **Voice dictation.** With the browser engine (Chrome, Edge), the audio is processed by the browser's own speech
  service. With the server engine, a hidden `agy` sends the audio to Google's speech service, like its `/voice`
  command. Either way only while you dictate, and the audio is not saved. Turn it off with `ARGOS_BOARD_NO_VOICE=1`.
- **Notifications.** Your browser shows them; the text does not leave your machine.
- **Links.** "Read the full policy" in Settings opens this page on GitHub if you click it.

## Secrets

Before leaving the wrapper, screen lines go through pattern-based redaction (`sk-…` keys, `Bearer …`, `*_KEY=`,
`*_TOKEN=`, `*_SECRET=`, `*_PASSWORD=` variables). It is a basic filter and cannot be perfect: if you work with a
secret of another shape, it may show on the card. It is not written to disk and does not leave your machine.

## Network access

From a phone, traffic goes over plain HTTP. Use it on networks you trust or through an encrypted tunnel
(WireGuard, Tailscale), and do not put a reverse proxy in front (see the [reference guide](docs/guide.es.md), in Spanish). Any paired device has full access:
it can view, write to the agents and launch them.

## Your controls

- `argos-board devices` lists paired devices and `argos-board revoke <id>` (or `--all`) revokes them.
- Delete `~/.config/argos-board/control-token` and restart `serve` to remove write permission from every browser.
- Delete `~/.config/argos-board/` to remove everything the program stored outside your projects, and the `.argos/`
  folders in your projects to remove attached files.
- Uninstall with `cargo uninstall argos-board`.

## Changes

Changes to this policy are visible in this file's git history.
