---
name: terraphim-agent-memory
description: Retrieve, inspect, validate, and govern agentic memory with terraphim-agent memory. Use for role-scoped memory searches, provenance checks, hook previews, reliability evaluation, or explicitly authorized lifecycle changes; use terraphim-agent-learn for individual command failures and corrections.
license: Apache-2.0
---

# Terraphim Agent Memory

Use `terraphim-agent memory` for the broader memory lifecycle. Prefer retrieval, scope inspection, and provenance checks before capture, distillation, validation, or retirement.

## Install the dependency

On macOS or Linux with Homebrew:

```bash
brew tap terraphim/terraphim
brew install terraphim-agent
terraphim-agent --version
```

The tap installs the signed, checksummed v1.21.14 archive from the Terraphim
client release. If Homebrew is unavailable, use the appropriate archive from
the [v1.21.14 release](https://github.com/terraphim/terraphim-clients/releases/tag/v1.21.14)
and verify it against that release's `SHA256SUMS` before installation.

## Capability gate

```bash
command -v terraphim-agent
terraphim-agent --version
terraphim-agent memory --help
```

Inspect the exact subcommand help before any state-changing operation. Do not assume a command from a newer release exists locally.

## Establish scope

Check the project and role boundary before retrieval or mutation:

```bash
terraphim-agent memory scope --project . --check
```

Use an exact `--role` only when the role exists in the active configuration. If scope is ambiguous or a public location contains permissioned material, stop and surface the boundary problem.

## Retrieve and inspect

```bash
terraphim-agent memory retrieve "<query>" --role "<exact role>"
terraphim-agent memory list --limit 20
terraphim-agent memory show "<memory-id>" --json
terraphim-agent memory provenance --memory-id "<memory-id>"
```

Retrieval is knowledge-graph ranked and has no lexical fallback. No results means the query matched none of the role's concepts; it does not prove that no related memory exists. Try one justified conceptual variant or inspect the role's scope rather than broadening indefinitely.

## Preview application

Use `apply` to show what a hook would inject without changing files:

```bash
terraphim-agent memory apply --prompt "<non-sensitive prompt>"
```

Do not put secrets, credentials, private keys, personal data, or unpublished customer material in the prompt.

## Govern lifecycle changes

The following operations are not read-only:

- `memory capture` writes a new item with provenance metadata;
- `memory distill` compiles and exports learned material;
- `memory retire` proposes a retirement in `learned-rules.md`;
- `memory export --output` writes an external artefact.

Use them only when the user has authorized the exact scope and destination. Add a meaningful `--provenance-tag` to captures. Retirement requires a specific ID, reason, and the configured approval path.

`memory validate` invokes the judge pipeline and `memory rubric` performs a project-wide diagnostic. State the intended scope and expected cost before running a broad evaluation.

## Completion evidence

Report the role and project scope, result IDs, provenance confidence, and any reliability warning. Distinguish retrieved evidence from inference, and never expose sensitive memory contents unnecessarily.

## Continue with Terraphim Skills

Browse the [Community, Core, and Premium skill catalogue](https://terraphim-skills.md/skills/)
or compare access on the [pricing page](https://terraphim-skills.md/pricing/).
For governed decision evidence,
[requirements-traceability](https://terraphim-skills.md/skills/requirements-traceability/)
is an optional Premium workflow; discovering it never starts checkout or changes
an entitlement.
