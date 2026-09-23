# Getting Started

## Install

1. Settings → Plugin Management → Discover → `+` → add
   `jannotix/zcode-cycle-plugin` as a marketplace (GitHub repository or a
   local clone).
2. Install `zcode-cycle`, open the project and run `/cycle:setup install`.
3. Start a new session. **Windows: quit from the tray** if closing the
   window only hides the app and new plugins do not register until a
   real restart.
4. Run `/cycle:setup` in the main session. A clean bill of health ends with
   the data directory location, outside any application installation.

## First delivery

1. Discuss the change with the Cycle agent — planning conversation is
   read-only and free.
2. `/cycle:run auto` — the next message you send is captured verbatim as
   the immutable original request.
3. Send the request. The router picks quick or full; the governed flow
   runs: architecture, isolated worktree, implementation, verification,
   reviews (full route), arbitration, promotion.
4. When the delivery lands, commit the delivered changes in your project
   before the next run — promotion is fast-forward only.

## Model configuration

Roles inherit your session model by default. Assign per-role models
with `/cycle:models <role> <model-ref|inherit> [thought-level]` — for
example `/cycle:models architect custom:account%3Azai-individual-coding-plan:GLM-5.3 high`.
Assignments are constrained changes to managed project profiles and apply in a
new session. The provider id is URI-encoded and must be one this host has;
each pin is probed before a run starts. See the [model guide](models.md).
`/cycle:models` with no arguments shows every effective assignment.

## Update

Update the plugin from Plugin Management, run `/cycle:setup repair`, then
start a new session
(tray-quit on Windows). Your data — ledger, memory, goals, worktrees,
browser evidence — is untouched; it lives in your user data directory,
not in the plugin.

## Remove

Run `/cycle:setup remove` in each configured project, remove `zcode-cycle`
from Plugin Management and delete the marketplace entry. Audit data remains in
`%LOCALAPPDATA%\ZCode Cycle` (Windows) or `~/.local/share/zcode-cycle`
(Linux); delete that directory only if you want the data gone too.

## Troubleshooting

- **A command or role is unknown** — the plugin or project profiles did not
  load this session:
  restart (tray-quit on Windows).
- **Control plane unreachable** — `/cycle:doctor`; a missing or stale
  native binary means the platform install did not match.
- **Stuck install** — an install from a working-tree directory copies
  everything; always install from the assembled plugin directory.
- **Promotion refused: "not an ancestor"** — your project HEAD moved
  since the workflow started; commit delivered changes between runs.
