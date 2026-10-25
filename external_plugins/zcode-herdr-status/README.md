# ZCode Herdr status bridge

[中文说明](README_CN.md)

An opt-in **Standard plugin** for Linux: show the ZCode agent in the **current Herdr pane** as working, waiting for permission, or unknown. No MCP App, web server, session manager, or Ovis patch is included. Herdr and Ovis are independent projects; this package is not endorsed by them.

## Requirements and limits

- Linux with `/proc`, Python 3.10+ (standard library only), ZCode **3.16.3** (CLI 0.17.0), Herdr **0.9.5**. Other versions fail the check; this is an intentionally narrow initial compatibility range.
- An already running Herdr pane owned by your user, with inherited `HERDR_ENV`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH`. Do not fabricate those values from another shell. Your working directory must match the pane.
- Install and enable this plugin using ZCode's plugin manager, then use a **new, otherwise idle shell pane**. Normal ZCode sessions do not opt in automatically. Keep other status bridges disabled for this pane.
- Hooks alone cannot prove completion, cancellation, or a TUI permission rejection that emits no terminal Hook. `Stop` can be followed by another model iteration. In the default mode `Stop` becomes **unknown / Completion unverified**, not success. Unknown is never acceptance.
- Hooks-only hints also expire after 30 seconds without a new Hook and become **unknown / Status unverified**. This covers failures without a terminal Hook, but a legitimate long model generation or permission wait can also become unknown. Only new evidence refreshes the hint; no polling heartbeat fabricates activity.
- Optional `--experimental-db-status` uses private, version-pinned ZCode SQLite metadata. This is **not a public API**. It projects only IDs, timestamps, roles, finish/error classifications and tool lifecycle status for the exact bound session and current user-message parent; it does not return message text, reasoning, tool arguments or outputs. An unreadable/replaced/incompatible database produces unknown. Upgrades require revalidation and a new compatible release.
- The bridge does not fix authentication. A prior isolated trial encountered `project_token_login_failed`; re-login restored calls, but its cause was not established. Do not assume unattended reliability.

## Install and start

Install/enable `zcode-herdr-status` from the marketplace. For source development, follow the repository's [local marketplace workflow](../../docs/PLUGIN_DEVELOPMENT.md#18-test-a-plugin-locally). Find this plugin's enabled installation `rootPath` with `zcode plugins list --json`; set `PLUGIN` to that directory. Run these commands yourself in the new Herdr shell pane:

```bash
python3 "$PLUGIN/hooks/bridge.py" doctor
python3 "$PLUGIN/hooks/bridge.py" run
```

The bridge starts `zcode` with **no permission, model, language or tool-policy overrides**. Optional native arguments go after `--`; they are your explicit choice. Non-default executable locations can be supplied with `--herdr` and `--zcode`. Do not bypass confirmation/security policies to make a trial pass.

For more precise lifecycle reasons, explicitly opt in:

```bash
python3 "$PLUGIN/hooks/bridge.py" doctor --experimental-db-status
python3 "$PLUGIN/hooks/bridge.py" run --experimental-db-status
```

The default experimental database is the current user's `$HOME/.zcode/cli/db/db.sqlite`; `--db` permits another same-user regular file, never a remote database. The runtime version remains pinned. A successful doctor check verifies local installation/binding/schema, **not model login or connectivity**.

The launcher prints its run directory. `--state-dir` selects a private 0700 directory; default is `ZCODE_PLUGIN_DATA` when inherited, otherwise `$XDG_STATE_HOME/zcode-herdr-status` (fallback `$HOME/.local/state/zcode-herdr-status`). A per-socket/pane lock prevents duplicate observers from this state directory. Do not start competing copies with different state directories in the same pane.

## Stop, disable and rollback

From another terminal under the same user, use the exact run directory printed above:

```bash
python3 "$PLUGIN/hooks/bridge.py" stop "$RUN_DIR"
```

This stops only the observer and releases its own Herdr source; the native ZCode process continues. A missing release acknowledgement is reported as a failure, not clean shutdown. Disabling the plugin through ZCode is also detected by the observer's local inventory check (normally within five seconds, plus command timeouts). Exit the native session normally, then uninstall the plugin to return to the pre-install state. No prior plugin settings or credentials are restored/replaced because this plugin never changes them. Retain private run evidence if needed; delete only your own printed run directory after processes have exited.

Default observer lifetime is one hour, configurable with `--max-seconds` from 1 to 86400. On lifetime expiry, parent/native exit, plugin disable, or socket replacement the observer stops and tries to clear only its own source. It never kills the native agent. If Herdr is unreachable, release cannot be proven; inspect/reconnect rather than treating old UI state as fresh. An external UI's disconnected-state presentation is outside this plugin's scope.

## Side effects, privacy and provenance

- Automatic `process` Hooks: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Stop. They use `python3`, produce no stdout decisions/context, and are no-ops without the opt-in launch binding. Hook input is parsed transiently; only allowlisted lifecycle metadata is persisted, not prompts or credentials. This is an observer, **not a sandbox or permission authority**.
- Executes existing ZCode/Herdr binaries using argv, local plugin-inventory commands, and a bounded Python observer. The inherited socket's owner/inode and PID/start-time/UID lineage are checked; it never selects a UI-focused target or controls another session. No shell evaluation, input injection, approvals, service installation, runtime download or cloud access.
- Writes private lock, binding, sequence, event and stop-receipt files in the chosen state directory. Optional database access is read-only. Logs can contain session IDs and local paths; keep them private and do not submit raw logs/screenshots from customer work.
- No network requests, telemetry, model calls, API keys or fees are introduced by the observer itself. The native ZCode process uses your existing model/account/network configuration and may incur its normal usage costs. Herdr communication is over the existing local Unix socket.
- This bridge's source is Apache-2.0 (see LICENSE), adapted from an internal observational prototype. No ZCode, Herdr or Ovis binaries/source assets are bundled. ZCode and Herdr remain user-installed external dependencies under their own terms. Ovis is optional and is not part of the supported runtime check.

## Verification

```bash
python3 -B -m unittest discover -s external_plugins/zcode-herdr-status/tests -v
python3 scripts/validate.py
python3 scripts/build_dist.py
git diff --check
```

Use synthetic/local checks before real model use. Then, in an isolated profile, verify doctor, one new pane, a harmless prompt, permission rejection, cancellation, native exit, explicit observer stop while native remains alive, and plugin disable. Check a second unrelated pane remains untouched. Inspect both the UI and `transitions.jsonl` / `stopped.json`; transport acknowledgement is not task/content acceptance. Default hooks-only and experimental metadata modes must be judged against their different contracts. A prior internal prototype passed a short real-task trial; that evidence alone does not establish this portable version's compatibility or long-term reliability.
