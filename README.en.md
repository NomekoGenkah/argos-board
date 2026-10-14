# argos-board

[Español](README.md) · [Privacy](PRIVACY.en.md)

A local web board to watch, in real time, several CLI coding agents (`claude`, `opencode`, `agy`, `copilot`, or any
other command) running in different terminals. It mostly observes; from the page you can also write to an agent,
launch one, and see how much of each agent's quota you have used.

```
 terminal 1: argos-board run -- claude   ──┐
 terminal 2: argos-board run -- opencode ──┼─► argos-board serve (127.0.0.1) ──WS──► browser
 terminal 3: argos-board run -- agy      ──┘
```

> The page, its settings and its error messages are available in **English and Spanish** (Settings → Appearance →
> Language; "Automatic" follows the browser). This file is the English summary: the detailed reference, including
> detection profiles and calibration, is the [Spanish README](README.md) and
> [`docs/argos-board-spec.md`](docs/argos-board-spec.md).

**States:** `working` / `idle` (from changes on the agent's screen), `waiting_input` (the agent asked you a question
and waits for your answer), `waiting_approval` (it asks for permission), `error`, `exited` and `disconnected`.

## Install and run

Requires stable Rust (tested with 1.98) on Linux / WSL2.

```sh
cargo install --path .       # installs ~/.cargo/bin/argos-board; re-run after changing the code
argos-board serve            # http://localhost:8787  (--port for another one)
argos-board run -- claude    # one per terminal, wrapping the agent
argos-board run --name backend -- opencode
```

Open the link `serve` prints (`http://localhost:8787/#k=…`): with it the page can **write to the agents**; without
the token it works read-only. The wrapper is transparent: the agent is used exactly as without it.

## The page

- **Header**: the mark (an eye whose pupil takes the colour of what is going on, and which is also the tab icon),
  a *Board / Office* switch, a summary of what waits for you (`3 need you`, a button that jumps to the agent that has
  waited longest), *New agent*, the write permission, and *Settings*.
- **One card per agent**: the agent's own eye (it says the state without relying on colour: filled pupil = working,
  big pulsing pupil = waiting for you, empty pupil = idle, crossed = error, closed lid = finished), its name, the
  state and how long it has lasted, and the project and branch. Colour is reserved for state: green is working, red
  is "needs you".
- **A faithful terminal in every card**, drawn cell by cell with xterm.js: same columns and rows as the agent's
  terminal, its cursor, and OpenCode's or Copilot's box and block characters without seams. It has its own palette
  (Night, Paper, Solarized, Phosphor, Ink), independent from the page theme.
- **Usage bar** (at the bottom): for each of `claude`, `agy` and `opencode` you have installed, the server asks the
  agent's own CLI (`claude -p "/usage"`, `agy -p "/usage"`, `opencode stats`) and shows the session, week and 5 h
  percentages (and OpenCode's accumulated cost). It refreshes every 5 minutes while the page is open and results are
  cached, so with the page closed no command runs. From 75 % the bar is striped and from 90 % it changes colour: the
  level is readable without colour. Hide it in Settings, or on the server with `ARGOS_BOARD_NO_USAGE=1`.
- **Write to an agent**: each card has a one-line bar. Enter sends; Shift+Enter adds a line; with the box empty,
  ↑ ↓ and Esc go straight to the agent. The keyboard button opens quick keys and mode commands (`/plan`…). Attach
  files by the clip button or by dragging them (saved in the agent's project under `.argos/uploads/`). Voice
  dictation by the microphone button.
- **New agent** (with write permission): pick the type (only installed ones), the folder and an optional name. With
  tmux it runs in its own session and the card shows how to attach from a terminal.
- **Alerts**: when an agent starts waiting for you, the tab shows a counter and, if enabled, a browser notification
  and a short beep. One alert per wait, not per output.
- **Office**: the same information in pixel art, in a single floor plan. Where an agent is says its state.

### Settings

A sheet with everything customizable, saved in that browser:

- **Style**: **Watchtower** (the default: a watchtower at night, blue slate with the lantern amber only in the
  mark), **Notebook** (the warm paper-and-ink palette of the first versions), **Phosphor** (monospaced interface and
  old-monitor green) and **Ink** (high-contrast black and white, thick lines). Each one in light and dark. With no
  saved choice the theme follows the system, and someone who asks the system for more contrast starts with Ink.
- **Layout**: **Canvas** (free: drag and resize cards), **Grid** (equal cards in order of arrival) and **Focus**
  (one large agent and the rest in a list with their live screen).
- **Terminal**: colours, and how the terminal fits its card (automatic, whole terminal, fit to width).
- **Appearance**: Light/Dark, density, corners, language, and whether usage is shown.
- **Accessibility**: reduced motion (also respects the system's).
- **Presets** save style, layout, theme, terminal, density, corners and usage under a name. Four come **built in**
  as alternatives to the default (*Night watch*, *Study*, *Console*, *High contrast*); yours are kept apart and can be
  shared as text.

### Accessibility

Checked with axe-core (WCAG 2.1 AA) in all eight style × theme combinations, the settings sheet, dialogs, the
Office, the three layouts, in English and Spanish, and at 360 px. A "skip to content" link, visible keyboard focus,
live announcements only for important changes (question, permission, error, finished, disconnected), and a test that
checks the colour contrast of every style from `web/skins.css`.

## Access from other devices

`argos-board serve` also listens on the machine's **private networks** (LAN, WireGuard…) and prints where to connect
from and, the first time, a one-time pairing code (expires in 5 minutes, void after 5 wrong attempts). A paired
device gets its own revocable token and **full access**: view, write and launch.

```sh
argos-board pair                # another code
argos-board devices             # list paired devices
argos-board revoke <id|name>    # revoke one (or --all)
argos-board serve --local-only  # only this machine
argos-board serve --bind 10.8.0.1   # only these private IPs
```

Do **not** put a reverse proxy in front (the server tells "this machine" apart by the connection's source address).
Traffic is plain HTTP: use trusted networks or an encrypted tunnel.

## Security and privacy

Read the [privacy policy](PRIVACY.en.md) for exactly what is stored and sent. In short: no accounts, no telemetry,
no outbound network calls of its own; agent output is never written to disk and screen lines are redacted for
secrets (`sk-…`, `Bearer …`, `*_KEY=`, `*_TOKEN=`…) before leaving the wrapper.

### Environment variables

| Variable | Effect |
|---|---|
| `ARGOS_BOARD_CONFIG_DIR` | Another config folder (default `~/.config/argos-board`) |
| `ARGOS_BOARD_NO_VOICE=1` | The server does not offer voice dictation |
| `ARGOS_BOARD_NO_USAGE=1` | The server does not query agents' usage |
| `ARGOS_BOARD_NO_TMUX=1` | Agents launched from the page do not use tmux |
| `ARGOS_BOARD_LOG=<path>` | The wrapper writes a log (states and exit codes, never what you type) |

## Uninstall

`cargo uninstall argos-board`. To also remove what it stored: `~/.config/argos-board/` and the `.argos/` folders of
projects where you attached files; in the browser, "Clear site data".

## Development

```sh
cargo test                                # unit + integration (fake CLI in tests/fake_agent.sh)
cargo clippy --all-targets -- -D warnings
cargo fmt --check
node --test tests/web/*.test.mjs          # page logic that needs no browser
```

- `src/server/` — `serve`: axum, in-memory state, WebSockets `/ws` (browser) and `/ingest` (wrapper), usage probes.
- `src/wrapper/` — `run`: PTY, raw mode, `vt100` emulator, activity detection, ingest client.
- `src/model.rs` — agent snapshot and messages (stable contract, see the spec §4).
- `web/` — the page, embedded in the binary: plain HTML, CSS and JS with no build; vendored libraries (gridstack,
  xterm.js) in `web/vendor/`; text in `web/lang/`; colours in `web/skins.css`.

## License

[MIT](LICENSE). The libraries in `web/vendor/` (gridstack.js, xterm.js) and the fonts in `web/fonts/` (Montserrat
and JetBrains Mono, OFL) keep their own licenses, with their license file next to them.
