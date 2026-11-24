# AGENTS.md — sebset

An Omarchy shell plugin: a scheduled, gentle night light that drives `hyprsunset`, with a bar icon
and a small settings menu. Public-facing open source in the making: every file is in English.
Its name is "sebset" (the owner's pick, 2026-11-24).

- Never edit `/usr/share/omarchy/` (reading is fine). The plugin is linked into
  `~/.config/omarchy/plugins/` for live testing.
- Pure logic lives in `Schedule.js` and is tested with `node --test tests/`; QML stays thin.
- Checks: `node --test tests/` and `qmllint` on changed QML (known Quickshell import warnings aside).
- Running cost is a requirement: no polling processes, no timers outside the shell; a process is
  spawned only when the screen temperature actually changes.
