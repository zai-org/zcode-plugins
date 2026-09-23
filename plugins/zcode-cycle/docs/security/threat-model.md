# Threat Model

ZCode Cycle moves trust from agent narration to a deterministic control
plane. This document states what it defends, what it assumes, and what
remains out of scope.

## Assets

- The integrity of the delivery record: ledger, checkpoints, evidence,
  candidate manifests.
- The user's repository and data directory contents.
- The isolation boundaries between roles and between the plugin and the
  host application.

## Trust boundaries

1. **Plugin ↔ host application.** The plugin registers commands, skills,
   hooks and one MCP server through the host's extension surface, and never
   patches the application installation.

   ZCode CLI 0.16.9 also picks up the `agents/` directory this archive ships,
   **by convention and without the manifest declaring it**, and lists the five
   roles as dispatchable subagents with a per-agent model and reasoning level of
   its own. Assume they are reachable from any session, not only from a governed
   run. That is not a hole this plugin opens: the definitions the host reads are
   the same managed role profiles, carrying the same bounded `tools:` lists, and
   the host's built-in `general-purpose` subagent already holds every tool.

   `/cycle:setup install` writes those five profiles under the project's
   `.zcode/agents` for a different reason: a dispatched role is bounded by the
   tool list in its profile, because the host does not run `PreToolUse` inside a
   dispatched agent. The hooks guard what the main session does; the profile
   guards what a role can do once dispatched. A project-scoped profile is also
   what the fail-closed hook checks for before allowing a dispatch.
2. **Bridge ↔ control plane.** The MCP bridge and hooks speak framed IPC
   to `workflowd` over a named pipe (Windows) or unix socket (Linux),
   authenticated with a local HMAC challenge-response bound to a
   per-installation secret in the data directory. Only local processes
   that can read the runtime secret connect.
3. **Roles.** Read-only roles lack edit and shell tools at the managed
    profile level; a PreToolUse hook re-checks the qualified host identity.
    Every Cycle role dispatch and every executor mutation requires one unique
    active registration for the current project. Interactive browser
   actions are executor-only. No dispatched role can launch a workflow;
   arbitration is only accepted by the daemon in the arbitration state
   for the exact frozen candidate digest. No role may delegate to another
   subagent. The executor may add and commit its authorized worktree changes,
   but the hook rejects Git operations that switch or rewrite history,
   destroy candidate state, create another worktree, tag or publish.
4. **Browser.** Isolated profile per session; loopback only by default;
   external origins blocked (including background requests) until
   explicit user approval; uploads confined to the project directory;
   filled values redacted from all evidence.

## Integrity guarantees

- Ledger entries form a hash chain with signed checkpoints
  (`/cycle:history verify`); tampering is detectable.
- Candidates are frozen with per-file, diff, configuration, dependency
  and environment digests; verification always runs against the frozen
  manifest; verdicts must bind to the candidate digest and cite real
  evidence ids the daemon knows.
- Verification commands are single invocations, shell-metacharacter
  free, with blocked programs (git, sh, powershell, cmd and friends) and
  destructive verbs; secret scanning runs over changed content; manual
  memories cannot claim verified confidence and must cite ledger events.
- Promotion is fast-forward only onto the recorded base revision.
- A malformed payload delivered to the high-risk PreToolUse hook is denied.
  Hook input is consumed as ZCode's one-line JSON protocol and never waits for
  stdin closure. Host and registry role identities must agree, and a raw
  Cycle-role dispatch without a unique registration is denied. Valid calls
  from sessions unrelated to Cycle are left to ZCode's own permission and
  confirmation policy; Cycle never weakens or bypasses that policy.

## Assumptions

- The user's machine and the ZCode application are trusted; a
  compromised host can read the IPC secret and the data directory, and
  no local-only design defends against that.
- The host application enforces the tool allowlists in project profiles and
  does not permit a sub-agent to delegate another sub-agent.
- The git repository is the source of base-revision truth.

## Out of scope

- Multi-user or remote attestation; everything here is single-machine.
- Protecting the user from code the executor legitimately wrote and the
  gates legitimately passed — the gates prove what was verified, not
  that the software is free of every defect.
