---
name: litman-setup
description: Install litman, the local literature manager, and connect it to ZCode. Use when the user mentions litman, `lit`, or their literature vault (文献库) and litman's own `lit-library` skill is not available, or when a `lit` command is not found.
---

# litman setup

litman (https://litman.dev) is a local literature manager driven by the `lit`
command. This skill only gets litman installed and connected to ZCode. After
that, litman's own skills (`lit-library`, `lit-reading`) do the real work.

## 1. Check

Run `lit --version`.

- It works and the `lit-library` skill is available: stop here and follow
  `lit-library` / `lit-reading`.
- It works but there is no `lit-library` skill: go to step 4.
- `lit` is not found: go to step 2.

## 2. Ask

Ask the user, in their language, whether to install litman. One or two
sentences: litman is a local literature manager, and installing it runs the
official installer from get.litman.dev. Do not install without a clear yes.

## 3. Install

Run the official one-line installer for this system:

- macOS / Linux: `curl -LsSf https://get.litman.dev/install.sh | sh`
- Windows (PowerShell): `powershell -ExecutionPolicy ByPass -c "irm https://get.litman.dev/install.ps1 | iex"`

ZCode may not see the new PATH until it restarts, so `lit` can still be "not
found" right after installing. Then call it by its full path:
`~/.local/bin/lit`, on Windows `%USERPROFILE%\.local\bin\lit.exe` (if the
installer printed another directory, use that one).

## 4. Connect to ZCode

Run `lit install-skill --agent zcode` (with the full path if needed). It copies
litman's skills to `~/.agents/skills`, where ZCode finds them. If it reports
out-of-date copies, run it again with `--force`.

## 5. Vault

Run `lit vault list`. If no vault is registered, ask the user where to keep
their library, then run `lit init "<parent folder>"` (it creates
`<parent folder>/literature_vault` and makes it the active vault).

## 6. Hand over

Tell the user litman is ready. Do not list or explain `lit` commands from
memory: litman's own skills cover them, and `lit --help` lists them.

ZCode may load the new skills only in a new session: if `lit-library` is still
not available here, offer to run `lit agent zcode`, which opens the active
vault as a ZCode workspace, where litman's skills are available. From then on
use `lit-library` / `lit-reading`.
