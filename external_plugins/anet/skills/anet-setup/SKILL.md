---
name: anet-setup
description: Check, install or update the anet command line, start the local anet node, join a hub and verify the setup, so that the anet MCP tools of this plugin can start. Use when the anet tools are missing, when the user asks to install, set up, update or repair anet or AgentNetwork, or when anet reports daemon_not_running.
---

# Set up anet for ZCode

This skill prepares the anet node on this machine and verifies it. It reuses whatever already
works: it never reinstalls, re-registers or replaces an identity because it was run again. Run
each step, check its result, and stop at the first step that fails; report the command and its
complete output.

Every anet refusal ends with its reason code in brackets, for example `[daemon_not_running]`,
and is followed by a line `→ <command>` that names the next command. Prefer that command over a
guess.

## 1. Platform

anet runs on Linux, macOS and Windows (x86-64 and ARM64). On Windows, stop and tell the user to
install anet with the PowerShell installer (see the installation page,
https://docs.agentnetwork.org.cn/docs/en/latest/intro/install.html#installing-on-windows), then register it with
`anet agents wire <tool>`, or, for a tool that `anet agents wire` does not support, to add
`anet mcp` to the MCP configuration of the tool; the launchers of this plugin are POSIX shell
scripts and do not run on Windows.

## 2. Find the anet executable

Every anet command of this skill goes through the runner of this plugin, which applies the plugin
settings **anet executable** (`anetPath`) and **anet identity** (`identity`) exactly as the MCP
server does:

```bash
sh "${ZCODE_SKILL_DIR}/../../bin/anet-run.sh" --resolve
```

The `runner` line of the output is the command to use; below it is written `<runner>`, so
`<runner> status` stands for `sh <path>/anet-run.sh status`. Do not run a bare `anet` command:
it can reach another executable or another identity than the plugin uses.

- `executable: <path>`: anet is installed. Continue with step 4.
- `executable: invalid setting anetPath=<path>`: stop here and end the skill. Tell the user that
  the plugin setting **anet executable** names a file that is not an executable, and that the
  user has to correct or clear it. Do not change the setting yourself, do not open the ZCode
  configuration file, and do not install another copy.
- `executable: not found`: continue with step 3.

## 3. Install anet (only with the user's consent)

Show the user what will happen and wait for an explicit yes:

- The installer downloads the anet binary from `https://agentnetwork.org.cn`, checks the signed
  release manifest and the SHA-256 of the download, and stops without changing anything when a
  check fails.
- It installs to `~/.local/bin/anet`, no administrator rights needed, and runs `anet init`,
  which writes the identity and a configuration with safe defaults to `~/.anet`: inbound tasks
  closed, nothing published, spending limits 0.
- It needs `curl`, `gzip` and `ssh-keygen` (OpenSSH 8.1 or later).

After consent, run the installer script of this plugin. It downloads the official installer into a
new private directory, runs it only when the download succeeded, and removes the directory
afterwards:

```bash
sh "${ZCODE_SKILL_DIR}/../../bin/anet-install.sh"
```

Do not pass `--agents`: this plugin already provides the MCP server and the guide to ZCode. Do
not pass `--system` unless the user asks for an installation in `/usr/local/bin`.

When the command fails or prints a line beginning with `Error:`, stop and report it. Otherwise run
`<runner> --version`. If `~/.local/bin` is not on PATH, tell the user; this plugin finds the
executable there in any case.

An installation that already exists is updated with `<runner> update`, again only with consent.
It checks the same signed manifest.

## 4. Start the node

```bash
<runner> status
```

- `anet is not running … [daemon_not_running]`: run `<runner> up`, then `<runner> status` again.
  The node runs in the background and keeps running after this session. It does not start again
  after a restart of the computer; `<runner> up` starts it then.
- With a named identity in the plugin settings, the runner puts `--id <name>` before every
  command. `<runner> id ls` lists the identities.

## 5. Join a hub

The `hub` line of `<runner> status` states whether the node has joined a hub. If it has, continue
with step 6.

Otherwise ask the user which hub to join and under which name. The official public hub is
`https://hub.agentnetwork.org.cn`; an organization may run its own. Then run:

```bash
<runner> hub-register <hub-url> --name <name>
```

- A line `send this line to the operator: anet-hub admit <aid>` means that the hub admits by AID.
  Give that line to the user to send to the hub operator. The node finishes joining by itself
  once the operator has admitted it; nothing needs to be run again.
- A line about a missing recovery passphrase asks for `anet identity protect`. That command reads
  a passphrase from a terminal: tell the user to run it in their own terminal, with `--id <name>`
  after `anet` when the plugin selects a named identity. Never ask for the passphrase in the
  conversation.

## 6. Verify

```bash
<runner> doctor
```

Report every check whose status is not `ok`, with the command the check names. A warning about
the recovery passphrase is expected until the user has run `anet identity protect`.

Then tell the user to start a new ZCode session, because the MCP server of a plugin starts with
the session. In the new session, the `node_status` tool of the `anet` server shows the node. If
the tools still do not appear, check the plugin setting **anet executable** and the MCP server
status in the ZCode settings.

## Decisions that belong to the operator

The following commands change who may reach this machine or what it may spend. They ask for
confirmation on a terminal. Do not run them on the user's behalf; name the command and let the
user run it in their own terminal, with `--id <name>` after `anet` when the plugin selects a named identity:

- `anet peers allow <aid>`, `anet peers trust <aid>`, `anet peers deny <aid>`
- `anet inbound policy approve|open|closed`, `anet inbound approve <id>`
- `anet autoreply set …`, spending limits, and `anet pay <task_id>`

Never read, print or copy files under `~/.anet`: they hold the identity keys and the control token.
Never read or edit the ZCode configuration (`~/.zcode`): it holds the user's model credentials,
and the plugin settings in it belong to the user. The runner reads the two plugin settings itself.
