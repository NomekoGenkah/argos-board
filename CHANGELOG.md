# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-19

First stable release. Argos Board is a local web board that shows what your CLI coding agents are doing and tells you
when one needs you.

### Added

- `argos-board serve` (web server) and `argos-board run -- <agent>` (transparent PTY wrapper that reports each agent
  to the server). The page is embedded in the binary.
- Agent states: `working`, `idle`, `waiting_input`, `waiting_approval`, `error`, `exited` and `disconnected`, detected
  from screen activity and per-agent patterns calibrated against real sessions (`claude`, `opencode`, `agy`,
  `copilot`; any other command works with generic detection). Patterns are overridable in `config.toml`.
- Board with a faithful xterm.js terminal in every card, three layouts (canvas, grid, focus), eight styles
  (four looks, light and dark), presets and a settings sheet.
- Office view: the same information as a pixel-art floor plan, where an agent's location says its state.
- Write to agents from the page (text, quick keys, file attachments, voice dictation) and launch agents from the page,
  both guarded by tokens and restricted to known agent types and allowed folders.
- Alerts when an agent starts waiting: tab counter, browser notification and optional sound.
- Usage bar with each agent's consumption, queried through the agents' own CLIs.
- Access from other devices on private networks (LAN, WireGuard) with one-time pairing codes, revocable devices and
  `--local-only` / `--bind` to restrict it.
- English and Spanish interface, mobile view and PWA manifest.
- Accessibility: axe-core clean (WCAG 2.1 AA) in every style, keyboard navigation, reduced motion.
- Privacy policy, MIT license, GitHub Actions CI and a release workflow publishing Linux binaries.

### Security

- Host and Origin validation, private-network-only connections, 0600 token files, secret redaction of screen lines
  before they leave the wrapper, and input size limits.

[Unreleased]: https://github.com/nomekogenkah/argos-board/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nomekogenkah/argos-board/releases/tag/v1.0.0
