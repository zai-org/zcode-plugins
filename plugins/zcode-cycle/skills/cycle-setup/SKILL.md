---
name: cycle-setup
description: Use when initializing Cycle for Zcode in a workspace or after installation changes. Checks the control plane, managed project role profiles, current-session role resolution and data placement without hiding restart requirements.
---

# ZCode Cycle Setup

Run these checks in order and report facts, not guesses.

1. Call `cycle_health`. Expect product and protocol versions,
   `schema_mode: read_write` and an absolute `data_directory`. A protocol
   mismatch means the plugin and native package differ; tell the user to
   reinstall matching versions. A missing data directory is a setup failure;
   never search for or infer a substitute path.
2. Call `cycle_control` with operation `doctor` for the current project.
   Report every diagnostic the control plane returns.
3. Call `cycle_role_profiles` with operation `status`. All five entries must
   be `current`. Missing profiles require the explicit command
   `/cycle:setup install`; managed drift requires `/cycle:setup repair`;
   an unowned conflict is never overwritten and must be resolved by the user.
4. Verify current-session role resolution: the Agent tool must list
   `zcode-cycle:architect`, `zcode-cycle:executor`,
   `zcode-cycle:functional-reviewer`, `zcode-cycle:security-reviewer` and
   `zcode-cycle:arbiter`. If any is missing, the project profiles were not
   loaded at session start — tell the user to start a new session (on
   Windows, quit from the tray if a normal restart does not reload them).
5. Report the authoritative data directory from `cycle_health` and confirm it is
   outside any application installation directory.
6. Close with a numbered list of required user actions, or state that
   setup is complete and `/cycle:run` arms the next request.

The status form never modifies project files. Install, repair and removal are
allowed only when the user invoked that exact setup subcommand; the command
supplies the corresponding confirmation token. Never treat a plain
`/cycle:setup` as permission to write or delete role profiles.
