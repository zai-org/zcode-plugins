# İAA — İştirak-i A‘mâl-i Ajanîye (ZCode plugin)

Version: 0.1.1

A **delegation-decision policy** for agent CLIs: one skill that decides *whether,
when, and how* to delegate work to subagents — adaptively, per task — with a
zero-agent fallback for small or tightly coupled work and sole orchestration
authority in its mode.

- **Purpose:** govern delegation decisions in the primary Agent. Delegate only
  when a concrete benefit (genuine parallelism, bounded-context isolation,
  specialization, context offloading, independent verification) outweighs the
  coordination cost; small, trivial, or tightly coupled work stays in the
  primary context (zero-agent fallback).
- **What it is not:** not a framework — no roles, no review quotas, no state
  files, no planning phases; and it never disables, patches, or reconfigures
  another plugin, framework, or setting. It yields to a workflow the user
  explicitly names by request.
- **Components:** exactly one Skill (`iaa` — the delegation policy) and one
  explicit Command (`/orchestrate`). Nothing else: no bundled agents, no hooks,
  no MCP servers, no daemon.
- **Dependencies:** none.
- **Permissions:** none required.
- **Network access:** none. İAA introduces no external network dependency and
  requires no İAA API key (your own ZCode model provider account is enough).
- **Side effects:** none at runtime. The optional integration step (documented
  in the repository) writes one marker-delimited block into `~/.zcode/AGENTS.md`
  only when explicitly run by the user.
- **Install / disable / uninstall:** install and enable through the ZCode
  plugin manager (marketplace). Disabling the plugin removes the skill and the
  command from discovery; uninstalling removes only plugin-managed files —
  nothing else on your machine is modified.
- **How to trigger:** `$iaa` (explicit skill invocation), implicitly when a task
  materially benefits from delegation, or the `/orchestrate` command as the
  explicit entry point.
- **Compatibility:** version-pinned claims only — see the compatibility matrix
  in the source repository. No universal compatibility is claimed.
- **License:** MIT (see `LICENSE`); acknowledgements in `NOTICE`.
- **Source:** https://github.com/isakli05/iaa
