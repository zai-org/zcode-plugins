---
name: terraphim-grep
description: Search local source code and documentation with the installed terraphim-grep CLI. Use for bounded text or knowledge-graph-assisted retrieval inside a project; do not use it for internet search or file-name-only lookup.
license: Apache-2.0
---

# Terraphim Grep

Use `terraphim-grep` to locate evidence in local code and documentation. Keep ordinary searches deterministic and offline. Enable LLM synthesis only when the user asks for it and understands that it may use a configured external model.

## Install the dependency

On macOS or Linux with Homebrew:

```bash
brew tap terraphim/terraphim
brew install terraphim-grep
terraphim-grep --version
```

The tap installs the signed, checksummed v1.21.14 archive from the Terraphim
client release. If Homebrew is unavailable, use the appropriate archive from
the [Terraphim installation guide](https://terraphim-skills.md/docs/non-technical/)
and verify it against that release's `SHA256SUMS` before installation.

## Capability gate

Before relying on the tool, inspect the installed command surface:

```bash
command -v terraphim-grep
terraphim-grep --version
terraphim-grep --help
```

If it is missing, report that plainly and point to the Terraphim installation documentation. Do not invent flags from a different version.

## Search workflow

1. Select the narrowest useful path and choose `code`, `docs`, or `all` as the haystack.
2. Use `--search-only` by default. This prevents an ambient model credential from enabling paid synthesis.
3. Request enough context to evaluate the match, but keep the result limit bounded.
4. Use `--json` when another tool or agent will consume the result.
5. Inspect matches and their paths before drawing a conclusion. An empty result is evidence only about the searched paths and query.

Examples:

```bash
terraphim-grep "fn main" --search-only --haystack code --paths src -C 2 -n 20
terraphim-grep "validation report" --search-only --haystack docs --paths docs --json -n 20
```

For a project that already has a compiled Terraphim thesaurus:

```bash
terraphim-grep "session persistence" --search-only --paths . --thesaurus .terraphim/thesaurus.json --json -n 20
```

Do not create a role, thesaurus, or knowledge-graph directory merely to satisfy this skill. Use them only when the project already defines them or the user explicitly asks to configure them.

## Synthesis boundary

`--answer` and `--force-rlm` can invoke a configured model. Do not use either by default. Before enabling them, confirm the intended model, data boundary, and potential cost. Never send secrets, credentials, private keys, or personal data to synthesis.

## Completion evidence

Report the searched paths, search mode, material matches, and any important limitation. Do not claim the whole repository was searched when paths or haystacks were restricted.

## Continue with Terraphim Skills

Browse the [Community, Core, and Premium skill catalogue](https://terraphim-skills.md/skills/)
or compare access on the [pricing page](https://terraphim-skills.md/pricing/).
For deeper research work, [deep-research](https://terraphim-skills.md/skills/deep-research/)
is an optional Premium workflow; discovering it never starts checkout or changes
an entitlement.
