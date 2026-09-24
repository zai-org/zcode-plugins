# Cycle for Zcode

Cycle for Zcode is a local evidence-gated delivery plugin for ZCode. It
separates architecture, implementation, functional review, security review and
final arbitration, while a deterministic Rust control plane owns workflow
state, candidate bytes, verification evidence and delivery.

## Release status

- `1.0.11` is the current production version. It lets an update replace the
  daemon it is updating: `1.0.10`, the first to be installed as an update over a
  running `1.0.9`, could not stop the old daemon and never became healthy. It
  also carries everything `1.0.10` closed. See the [changelog](CHANGELOG.md).
- `1.0.10` is published and superseded before certification. Install `1.0.11`
  instead. It closes the defects the first
  isolated live certification campaign found in `1.0.9`: a secret-scan gate
  that read names and never values, a verification abandoned by any gate that
  could not start, a freeze refusal that told the run to revert the operator's
  project, per-role model assignment blocked by its own documentation, and a
  ledger that named the wrong provider. See the [changelog](CHANGELOG.md).
- `1.0.9` is published and superseded. It passed all thirteen scenarios of that
  campaign, and the campaign is what found the defects above. Install `1.0.11`
  instead.
- `1.0.8` is published and superseded. It exists because the certification host
  moved while `1.0.7` was being set up: the bundled ZCode CLI went from `0.16.5`
  to `0.16.9`, and that number is stated in the shipped threat model, so the
  published `1.0.7` archive described a host configuration that no longer exists.
  Its own threat model carries the statement `1.0.9` corrected. Install `1.0.11`
  instead.
- `1.0.7` is published and superseded before it was ever certified. Its seven
  fixes are in `1.0.11` byte for byte. Install `1.0.11` instead.
- `1.0.6` is published and superseded. Eleven of thirteen scenarios passed; the
  two that failed — per-role model dispatch and recovery after an abrupt stop —
  are closed in `1.0.11`, along with a project-identity split, a first-run
  deadlock, path-blind risk routing, one documentation error and a release gate
  that passed the daemons it exists to reject. Do not install it in preference
  to `1.0.11`.
- `1.0.5` was never published. It was sealed and carried through the full
  campaign a second time: ten scenarios passed, one was partial and two failed.
- `1.0.4` is a superseded, never-published candidate. It was sealed and carried
  through the full thirteen-scenario live campaign: nine scenarios passed, two
  were partial and two failed, and eight defects were found — among them a
  mandatory interface gate removed by declaring a write scope one level coarser,
  a goal completed by citing sixty-four zeros as arbiter evidence, and one
  workspace holding more than one audit identity. All are closed in `1.0.5`. It
  must not be installed or reused.
- `1.0.3` is a superseded, never-published candidate. Its live campaign found
  three defects, two of them fixes from that same release that never ran; those
  are closed in `1.0.4`. It must not be installed or reused.
- `1.0.2` is a superseded, never-published candidate. It was sealed and carried
  through the full live certification, which found seven defects that no test
  suite had caught; fixing them changed the bytes. The campaign's findings are
  why `1.0.3` exists, and `1.0.2` must not be installed or reused.
- `1.0.2-rc.4` is a superseded internal candidate and was never published. It
  must not be installed or reused: it carries different bytes under a different
  identity.
- `1.0.2-rc.3` is superseded: the exact Desktop probe supplied the raw role as
  camelCase `agentType`, which that candidate did not normalize. Do not install
  or reuse it.
- `1.0.2-rc.2` is superseded: an exact Desktop raw-dispatch probe exposed an
  ungoverned host-native `SubAgent` route. Do not install or reuse it.
- `1.0.2-rc.1` is superseded because the Desktop did not discover its standard
  hook file; it must not be installed or reused.
- `1.0.1` is a superseded, never-published candidate. It must not be installed
  or reused: different candidate bytes were exercised under that identity.
- `1.0.0` is withdrawn and must not be installed. Its historical tag is kept
  for auditability and is not reused.

## Supported scope for 1.0.11

| Platform | Status |
|---|---|
| Windows 11 x64 | Certification target |
| Linux x64, Ubuntu 22.04 and 24.04 | Certification target |
| macOS x64 / arm64 | Compatible but untested only after native build gates pass |
| Windows/Linux ARM64 | Unsupported |

The certification target is the current ZCode Desktop release recorded in the
release receipt. A newer ZCode version invalidates host-integration receipts
until the live matrix is repeated.

One exception inside that scope: the **browser and accessibility gates are
certified on Windows only**. They are expected to work on Linux — the
implementation is shared and the one platform-specific part is tested — but no
run has been observed there, and an unobserved row is not recorded as passed.
Cycle drives a browser you already have; see the
[browser guide](docs/guides/browser.md) for which ones it looks for and how to
name another.

## Installation

Production users should install the plugin only from the official ZCode public
marketplace after version `1.0.11` is accepted and published. Official
installation matters because the role profiles, the hook and the native daemon
all run with your privileges, and a trusted source is what makes their bytes
accountable.

For development and certification, add a **local directory marketplace** in
Settings -> Plugins -> Create -> Add marketplace, select this repository, then
install `zcode-cycle`. In each governed project run `/cycle:setup install`,
start a new ZCode session, then run `/cycle:setup` to verify the five managed
role profiles. The main session is the orchestrator; roles are sub-agents.
Every Cycle role dispatch requires one unique Cycle registration; a raw agent
launch that bypasses registration is denied.

Requirements:

- ZCode Desktop with plugin support;
- Node.js 22 or later available to plugin processes;
- Git and the build/test tools required by the governed project;
- Windows x64 or a supported Linux x64 distribution;
- Chrome, Edge or Chromium when a change requires managed browser evidence.

The platform `workflowd` daemon ships inside the verified plugin archive. It is
never downloaded or executed from a remote URL at runtime.

## What the plugin installs

- five explicit project role profiles: architect, executor, two reviewers and
  arbiter; the main ZCode session orchestrates them;
- slash commands and five workflow skills;
- a `PreToolUse` guard for the main session and a `PostToolUse` audit hook
  (ZCode does not run either inside a dispatched agent, so a role is bounded by
  its profile, not by these);
- one local stdio MCP server;
- a self-contained MCP/browser bridge built from the locked npm dependency graph;
- platform-bound `workflowd` binaries, user documentation and legal notices.

## Permissions and side effects

Cycle is intentionally capable of changing a project, but only after the user
arms a governed run.

### Files and Git

- Normal conversation, setup, architecture and review are read-only.
- `/cycle:setup install` writes five managed files under the current project's
  `.zcode/agents`; repair, model changes and removal require their explicit
  setup/model command forms and never overwrite an unowned conflicting file.
- Each role can be pinned to its own model, and the ledger records the model
  that role's profile pins — Cycle cannot observe ZCode's dispatch, so the
  record attests the assignment, not the inference. Cycle validates the *shape*
  of a model reference and nothing more: only ZCode resolves providers, and it
  answers when a role is dispatched. A pinned role is therefore reported as
  `dispatch_unverified` until it has started once, and a governed run probes
  every pinned role before it begins — so a provider ZCode cannot resolve costs
  you seconds rather than a whole architecture, execution and verification pass.
  Your main session is unaffected.
- The executor modifies an isolated Git worktree within declared write scopes.
  It may stage and commit those worktree changes.
- The executor is not sandboxed: it holds edit and shell tools. What bounds it
  is the control plane, which refuses to freeze a candidate unless your project
  still stands where the workflow started, with nothing uncommitted. Work that
  escaped the worktree stops the run and is named, rather than riding along.
- The control plane freezes exact candidate bytes, verifies them and promotes
  only the approved paths onto the recorded base revision.
- Export, cancellation with data loss, external browser origins and publication
  remain explicit user decisions. Cycle does not weaken ZCode confirmations.

### Command execution

The control plane runs verification commands declared in the validated plan.
Commands use direct argument vectors rather than an interactive shell; unsafe
operators, blocked programs and destructive forms are rejected. Commands run
with the user's operating-system privileges. Use ZCode in an isolated
development environment and review high-risk actions as its Terms recommend.

### Network and browser

- Cycle has no telemetry, account service, update service or remote backend.
- The MCP bridge and daemon communicate only through a local authenticated pipe
  or Unix socket.
- Managed browser sessions use an isolated temporary profile. Loopback origins
  are allowed; every external origin requires explicit approval. Browser
  requests then reach that approved origin directly.
- ZCode and any model/provider selected by the user operate under their own
  terms and privacy policies. Cycle never reads or stores provider credentials.

### Local data

Workflow state, the tamper-evident ledger, signing keys, worktrees, browser
evidence and project memory are stored outside the application installation:

| Platform | Default |
|---|---|
| Windows | `%LOCALAPPDATA%\ZCode Cycle` |
| Linux | `$XDG_DATA_HOME/zcode-cycle` or `~/.local/share/zcode-cycle` |
| macOS | `~/Library/Application Support/ZCode Cycle` |

Uninstalling the plugin leaves this audit data intact. Delete it only as a
separate, explicit data-destruction decision after taking any required backup.

## How delivery works

1. `/cycle:run auto|quick|full` captures the user's next request verbatim.
2. The architect produces a requirement-linked, bounded task graph.
3. The executor implements and commits tasks in an isolated worktree.
4. The control plane freezes the candidate and runs mandatory gates.
5. Full mode dispatches both shell-free independent reviewers.
6. The arbiter judges the original request, exact candidate and raw evidence.
7. Only an approved candidate is promoted. Rejection drives a bounded repair
   loop; interruption is recovered by `/cycle:resume`.

See [the user manual](docs/USER_MANUAL.md), [command reference](docs/commands/reference.md),
[threat model](docs/security/threat-model.md), [release verification](docs/releases/verification.md)
and the [live certification criteria](docs/releases/zcode-live-certification.md) every
release is measured against.

## Update, rollback and removal

- Never reuse a published version. Refresh the marketplace, update to a higher
  semantic version, run `/cycle:setup repair`, and start a new session.
- Release certification includes upgrade from the previous public version and
  rollback with preserved data. A newer database schema may open only in the
  documented safe read-only mode.
- Before uninstalling, run `/cycle:setup remove` in every configured project;
  then remove the plugin in ZCode. Remove the data directory separately only
  if the ledger, memory, evidence and recovery state are no longer required.
- **A ZCode limitation, not a Cycle one:** uninstalling removes the active
  installation and leaves the marketplace's own mirror behind. See below.

## Known ZCode limitations

These are host behaviours. Cycle cannot change them from inside a plugin, and
they are recorded here so that what you see after an uninstall is expected
rather than alarming.

**An uninstall does not remove the marketplace's mirror of the plugin.** The
installed copy under `plugins/cache/<marketplace>/<plugin>/<version>/` *is*
removed — that directory is emptied completely. What remains is ZCode's mirror
of the marketplace source, under `plugins/marketplaces/<marketplace>/` in your
ZCode profile: roughly 76 MB, and larger than the installation was, because it
carries the native daemon for **every** supported platform rather than only
yours.

Look in the right place. Someone who checks the plugin cache after an uninstall
finds it empty and concludes the removal was complete; the 76 MB is elsewhere.

ZCode's confirmation dialog states that it removes "the plugin's cached files,
its data directory, and any saved configuration" and that this "cannot be
undone". The marketplace mirror is not among them, and neither is your Cycle
data directory — the dialog means ZCode's own per-plugin data directory under
`plugins/data/`. Treat the wording as describing the installation.

The retained copy is inert: it is not listed in `installed_plugins.json`, so
nothing loads it, and no daemon process runs from it after an uninstall. It
costs disk space and nothing else.

One process does outlive the uninstall until ZCode restarts: the plugin's MCP
server in any session that was already open. ZCode does not stop it. It is
inert - its files are gone, so any Cycle call from that session fails with
`required native package ... is not installed` and no daemon starts. Restart
ZCode after uninstalling and it is gone.

**An update keeps the previous version's installed copy too.** Updating from the
Plugin Marketplace installs the new version beside the old one under
`plugins/cache/<marketplace>/zcode-cycle/<version>/` and leaves the old folder
complete. It is inert in the same way: `installed_plugins.json` names only the
new version and nothing runs from the old one. Delete the old version's folder
if you want the space back.

**Updating stops the previous version's daemon.** The daemon outlives ZCode
sessions, so after an update the old one is usually still running. From
`1.0.11` the new plugin finds it by the data directory it serves, stops it when
it is older, and starts its own; it never stops a daemon newer than itself.
`1.0.10` and earlier could not: an update from them ends in *"workflowd did not
become healthy within 15 seconds"* until the old daemon is stopped by hand
(Task Manager, or `Stop-Process -Name workflowd`) or Windows restarts.

To reclaim the space, remove the marketplace itself in ZCode after uninstalling
the plugin. Cycle deliberately does not delete it for you: the mirror and its
registry belong to ZCode, and a plugin reaching into the host's registry to
erase entries would be a worse fault than the disk space it recovers.

Your audit data is a separate matter and is **not** removed by an uninstall.
The Cycle control plane lives outside the plugin tree precisely so that removing
the plugin cannot destroy the ledger, memory, evidence and recovery state.
Delete that directory yourself only when you no longer need the record.

## Windows SmartScreen and the unsigned daemon

Cycle ships a native control-plane daemon, `workflowd.exe`, and **it is not
signed with an Authenticode certificate**. `authenticode.json` in every release
records this as `NotSigned`, and the release pipeline verifies that it is
genuinely unsigned rather than badly signed — a broken signature fails the
build, an absent one is declared.

So Windows may object, in one of two ways:

- **SmartScreen** — "Windows protected your PC", naming an unrecognised
  publisher. This is a *reputation* check, not a malware verdict: it fires
  because no certificate identifies who published the file, and because files
  that arrive from the internet carry a Mark of the Web.
- **Microsoft Defender or Smart App Control** may block or quarantine the
  daemon for the same reason.

### Verify first, then unblock

Do not click through a security warning on trust. Check that the bytes you have
are the bytes that were published, then tell Windows you accept them.

**1. Compare the checksum** with the `.sha256` file published beside the archive
on the release page:

```powershell
Get-FileHash .\zcode-cycle-<version>.zip -Algorithm SHA256
```

**2. Verify the build provenance** — this proves the archive was built by this
repository's release workflow, from the commit the release names, and not
assembled by someone else:

```powershell
gh attestation verify .\zcode-cycle-<version>.zip --repo jannotix/zcode-cycle-plugin
```

**3. Only if both check out**, remove the Mark of the Web:

```powershell
Get-ChildItem -Recurse "$env:LOCALAPPDATA\ZCode Cycle" | Unblock-File
```

The same is available in the file's **Properties** dialog: tick **Unblock** at
the bottom of the General tab, then Apply.

If a SmartScreen dialog appears while you are launching something directly,
**More info → Run anyway** is the equivalent choice. Reach for it only after
steps 1 and 2.

### Where the daemon actually runs from

Cycle does not execute the copy inside the plugin cache. Before every start it
checks the binary against the SHA-256 declared in `bin/native-manifest.json` and
copies it to

```text
<data directory>\runtime\native\win32-x64\<sha-256 of the binary>\workflowd.exe
```

where `<data directory>` is `%LOCALAPPDATA%\ZCode Cycle` unless you set
`ZCODE_CYCLE_DATA_DIR`. Every release has a different digest, so it lands in a
new folder: a decision you make for one version does not silently carry over to
the next, and you repeat these steps after each update.

### If Defender quarantines it

Restore it from **Windows Security → Virus & threat protection → Protection
history**. If it keeps being quarantined, add an exclusion for the **native
folder only**, never the whole data directory:

```powershell
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\ZCode Cycle\runtime\native"
```

That needs an elevated PowerShell. An exclusion is permanent and covers anything
that later lands in that folder; the only thing Cycle ever writes there is a
binary whose digest the bridge verified first, which is what makes this folder,
and no wider one, a defensible place for it. Remove it with
`Remove-MpPreference -ExclusionPath` with the same path.

### If Smart App Control blocks it

Smart App Control (Windows 11, **Windows Security → App & browser control**)
is different: it has no per-file exception. When it is **On** it refuses
unsigned executables it has no reputation for, and there is no Unblock, no
Run anyway and no exclusion that changes that. Your choices are:

- turn Smart App Control **Off**. On current Windows 11 builds that cannot be
  undone without resetting or reinstalling Windows, so decide deliberately; or
- keep it On and do not use Cycle on that machine.

If it is in **Evaluation** mode, Windows decides by itself whether to switch it
on; a block during evaluation is the same decision as On.

### Managed machines

On a machine whose security settings are set by an organisation (Intune, Group
Policy, WDAC/AppLocker), none of the steps above may be available to you, and
working around them is not something this project will help with. Ask the
administrator to allow the binary by its SHA-256 hash, published in
`bin/native-manifest.json` and in the release's `release-manifest.json`.

### Why there is no certificate

A code-signing certificate is a recurring purchase tied to a verified legal
identity, and this project does not have one. Signing would remove the warning;
it would not make the bytes more trustworthy than the checksum and the
provenance attestation already make them, which is why those are published for
every release and why this section asks you to use them.

## Development checks

```text
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features --no-fail-fast
cd mcp && bun install --frozen-lockfile && bun run typecheck && bun run build && bun run test
node scripts/release/run-battery.mjs --iterations 1
```

The public release also requires the official marketplace validator/build,
20/20 deterministic batteries on both certified platforms, clean-install/live
ZCode checks, and SBOM/notices/provenance.

### Windows code signing

The bundled `workflowd.exe` is **not** Authenticode signed, and will not be. Windows
SmartScreen will warn on first use, some endpoint protection may quarantine it,
and environments that refuse unsigned executables by policy will refuse it.

What still holds without a signature: the plugin declares each native binary's
SHA-256 in `bin/native-manifest.json`, the bridge verifies it before the daemon
is ever executed and refuses a mismatch, the binary is materialized read-write
for its owner only, and the ZCode client verifies the archive digest on install.
Build provenance is attested for the sealed artifacts. Integrity is therefore
demonstrated; what is missing is the operating system's own trust decision and a
publisher identity carried inside the file.

No release of this project will be signed: a code-signing certificate is a
recurring purchase tied to a verified legal identity, and the project has chosen
not to carry one. The **Windows SmartScreen and the unsigned daemon** section
above explains how to verify a download and how to let Windows run it.

On Linux there is no Authenticode equivalent and none is claimed. The guarantee
there is the same one that holds on Windows without a certificate — the declared
SHA-256 verified before execution, the archive digest verified on install — plus
build provenance attested for the sealed artifacts, which lets anyone check that
a binary came from this repository at a named commit through the published
workflow. The Linux daemon is built on Ubuntu 22.04 and its GLIBC floor is
verified at 2.35 or lower, so it runs on 22.04 and 24.04 alike.

## Security and legal

Report plugin vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Report ZCode host vulnerabilities through ZCode's own private reporting channel.

Copyright 2026 Gianluca Iannotta. Licensed under FSL-1.1-MIT; each released
version becomes available under the MIT License two years after its release
date. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Cycle for Zcode is an independent integration. It is not affiliated with,
sponsored by or endorsed by ZCode or its operator. ZCode names and trademarks
belong to their respective owners.
