# Mimosa — Code Security Protection

[简体中文](./README_CN.md)

Mimosa adds local-first code-security guardrails to ZCode. It checks candidate edits before they are written, reviews changes at the end of a turn, guards Git commit/push commands, and provides an optional MCP server for explicit sealed repository scans.

## Platform support

This package is a pure Node.js build with no native executables. It is intended for current ZCode releases on macOS, Linux, and Windows, and requires `node` to be available in `PATH`. No separate model API key is required for the local hooks or native scan engine.

The vendor payload is stored unchanged under `payload/`. Its Ed25519-signed inventory is verified before protected code is loaded; the outer directory only supplies ZCode-standard manifests and cross-platform process hook definitions and a stdout transport adapter.

## Included capabilities

- `PreToolUse` and `PostToolUse` checks for file edits and shell commands.
- `UserPromptSubmit`, `SessionStart`, and `Stop` lifecycle hooks.
- `/mimosa-scan`, `/mimosa-status`, and `/mimosa-deep-audit` commands.
- The `mimosa-security-scan` skill for explicit deep security reviews.
- A `mimosa` stdio MCP server for explicit sealed repository scans. The plugin does not override the host's activation state.

## Installation

Open **Settings → Plugins**, search for **Code Security Protection**, and install `mimosa` from the official marketplace. For local verification, add the `zcode-plugins` repository root as a local marketplace, then install `mimosa` from that source.

Start a **new task** after installing, enabling, disabling, or changing plugin options because ZCode snapshots hooks and MCP configuration at task startup.

## Basic verification

1. Run `/mimosa-status` to inspect the current project's latest Mimosa state.
2. Ask ZCode to create an intentionally unsafe SQL or command-execution snippet in a disposable project. The pre-write hook should reject a confirmed high-risk candidate and return remediation context.
3. Confirm that the `mimosa` MCP server is active in ZCode, start a new task, and run `/mimosa-deep-audit` for an explicit sealed scan.

Hook checks, end-of-turn review, and Git gates do not depend on invoking an MCP deep scan.

## Optional Semgrep engine

The bundled native engine works without Semgrep. To explicitly install the pinned Semgrep CE runtime into Mimosa's user data directory, run:

```bash
node payload/dist/cli.js semgrep install --accept-license
```

This optional installation accesses the network, does not use `sudo`, and does not modify the system Python installation.

## Configuration

- `engine`: static engine for the optional MCP server. The default is `native`.
- `MIMOSA_HOOK_FAILURE_MODE=open|strict`: controls edit-hook infrastructure failure behavior.
- `MIMOSA_GIT_GATE_FAILURE_MODE=open|strict`: controls Git-gate infrastructure failure behavior.
- `MIMOSA_HOOK_STATUS=quiet|important|all`: controls hook status output.
- `MIMOSA_HOOK_PROJECT=1`: enables non-blocking cross-file warnings.

The plugin writes project-relative state under `.mimosa/` and persistent scan history outside the project under the user's Mimosa data directory. It does not write runtime data back into the installed plugin directory.

## Security notes

Hooks execute local code with the user's permissions. Review third-party plugins before enabling them. A completed static scan is evidence for the scanned scope, not a guarantee that a project is vulnerability-free; partial coverage must be reported as inconclusive.

## License

MIT. See [LICENSE](./LICENSE).

## 1.0.4 — reliable hook decisions

Hook commands now run through a small Node.js transport adapter. The unchanged signed vendor payload writes its decision to a private temporary file; the adapter waits for the complete JSON to reach the host pipe before exiting. This prevents immediate process exit from dropping a security decision under stdout backpressure. Adapter failures block PreToolUse instead of reporting a successful empty result. Temporary output files are removed after each run. Start a new ZCode task after upgrading so the new hook entry points take effect.
