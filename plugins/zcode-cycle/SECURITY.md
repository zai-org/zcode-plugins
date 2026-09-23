# Security Policy

## Supported versions

`1.0.5` is unreleased. `1.0.4`, `1.0.3`, `1.0.2`, `1.0.2-rc.4`, `1.0.2-rc.3`,
`1.0.2-rc.2`, `1.0.2-rc.1` and `1.0.1` are superseded internal candidates and
were never released; `1.0.0` is withdrawn. None is supported for production use.

## Reporting a Cycle vulnerability

Use the repository's private GitHub Security Advisory form. Do not place
secrets, exploit payloads, customer code or private machine paths in a public
issue. Include the affected version, platform, ZCode version, reproduction,
impact and the smallest evidence needed to validate the report.

If the defect is in ZCode rather than this plugin, report it through ZCode's
official private feedback/security channel and follow its disclosure terms.

## Security boundaries

- Cycle is local-first and has no telemetry or remote service.
- It executes project verification and Git operations with the current user's
  privileges; it is not an operating-system sandbox.
- Read-only roles declare mutating, shell and delegation tools away. This is
  the boundary that holds them, and it is the only one: ZCode does not run the
  PreToolUse hook inside a dispatched agent, so the hook cannot stand behind the
  profile as a second layer. The hook guards the main session — it denies
  mutation while a workflow is locked and denies a role dispatch without a
  unique registration.
- **The executor is not sandboxed, it is reconciled.** It legitimately holds
  edit and shell tools, so the profile cannot bound it the way it bounds the
  others, and the hook does not reach it. Nothing stops it writing outside the
  isolated worktree. What stops that write from becoming a delivery is the
  control plane, which every role must pass through: freezing a candidate
  refuses to proceed unless the project still stands at the base revision the
  workflow started from, with nothing uncommitted, and the refusal names the
  files that appeared. Two live certification runs saw work reach the project
  before any gate ran on it; that now fails at the freeze rather than surfacing
  at delivery or not at all.
- The project path used for that check comes from the code index, not from the
  caller, so a role cannot aim it at a directory where it left nothing.
- Promotion holds the same line from the other side: it refuses a candidate
  whose project has moved underneath it, and refuses to overwrite any
  destination that no longer matches its approved base.
- The residual risk is detection, not prevention: a role that wrote into the
  project and then restored it exactly would pass, having delivered nothing.
- External browser origins require explicit approval and use an isolated
  temporary profile. Approved websites remain third parties with their own
  security and privacy terms.
- IPC is local and authenticated. A user or process able to read the Cycle data
  directory is inside the trust boundary.
- Release binaries are necessary prebuilt components. Production publication
  requires exact-source provenance, checksums and SBOM/notices.
- **The Windows daemon in `1.0.5` is not Authenticode signed.** SmartScreen will
  warn, endpoint protection may quarantine it, and policies that refuse unsigned
  executables will refuse it. Integrity does not depend on that signature: the
  plugin declares each native binary's SHA-256 in `bin/native-manifest.json`, the
  bridge verifies it before executing the daemon and refuses a mismatch, and the
  ZCode client verifies the archive digest on install. What a signature would add
  is the operating system's trust decision and a publisher identity inside the
  file. Report a signature that exists but does not verify as a vulnerability;
  its absence is this documented limitation.

See [the full threat model](docs/security/threat-model.md) for assumptions and
out-of-scope risks.
