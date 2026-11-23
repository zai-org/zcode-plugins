# Terraphim Skills Introduction

[中文文档](./README_CN.md)

Three Community skills bring Terraphim's local code search, operational learning,
and agent memory workflows to ZCode.

## Install

1. Install the command dependencies:

   ```shell
   brew tap terraphim/terraphim
   brew install terraphim-grep terraphim-agent
   ```

2. Verify the installed command surface:

   ```shell
   terraphim-grep --version
   terraphim-agent --version
   terraphim-agent learn --help
   terraphim-agent memory --help
   ```

3. Open **Settings → Plugin management → Discover** and add the
   [Terraphim v0.2.4 personal marketplace](https://raw.githubusercontent.com/terraphim/terraphim-cursor-plugin/v0.2.4/marketplaces/zcode.json).
   Select **Terraphim Skills Introduction** and install it. Official catalogue
   inclusion is tracked in [the existing submission](https://github.com/zai-org/zcode-plugins/pull/13).
4. Start a new ZCode session so the three skills are discoverable.

The plugin never installs software automatically. If Homebrew is unavailable,
download the appropriate released archive using the
[Terraphim installation guide](https://terraphim-skills.md/docs/non-technical/)
and verify it against that release's `SHA256SUMS`.

## Skills

| Skill | Purpose | Example request |
| --- | --- | --- |
| `terraphim-grep` | Search bounded local code and documentation, offline by default. | “Use Terraphim Grep to find the authorization callback and show two lines of context.” |
| `terraphim-agent-learn` | Inspect failures and capture a verified operational correction. | “Capture what we learned from this failed deployment for the next session.” |
| `terraphim-agent-memory` | Save authored memory and read its actual ID, content and source tags. | “Save this deployment lesson, then show the stored text and ID.” |

The Agent checks the installed command's `--help` before relying on a changing
command surface. Search is read-only. Learning and memory writes happen only
after an explicit request. Memory capture uses the current user's OS-local store,
independent of the working directory; a project directory or search graph does
not isolate that memory store.

## Try both command-line tools

The [bundled workflow](skills/terraphim-grep/references/workflows.md) includes
copyable commands, a real editor-exported JSON graph and output checks using
[Clients 1.21.20](https://github.com/terraphim/terraphim-clients/releases/tag/v1.21.20).
Verify the release checksum and both installed versions; Homebrew may supply a
different version. The binaries are separate dependencies.

A concept note uses Logseq-compatible Markdown:

```markdown
# Risk
synonyms:: concern
```

Create the alternative in the [editor walkthrough](https://terraphim.ai/how-tos/synonym-search/)
and export its graph. The `--thesaurus` flag reads that exported JSON, not the
Markdown note. With `corpus/` containing the three Risk passages from the bundled
workflow, compare:

```shell
terraphim-grep Concern --search-only --haystack all --paths ./corpus --json -n 3
terraphim-grep Concern --search-only --haystack all --paths ./corpus \
  --thesaurus ./risk-concern.knowledge-graph.json --json -n 3
```

The baseline returns zero passages; the shared graph returns three Risk passages.
Both runs keep synthesis off. Inspect the source paths and lines in `chunks`.

To save a lesson, supply its content explicitly:

```shell
terraphim-agent --format json memory capture \
  --content 'Risk requires a Decision: approve a second supplier as the mitigation.' \
  --provenance-tag 'public-project-brief' > captured-memory.json
memory_id="$(python3 -c 'import json; print(json.load(open("captured-memory.json"))["memory_id"])')"
terraphim-agent memory show "$memory_id" --json > saved-memory.json
```

Check the returned ID, exact content and `provenance:public-project-brief` tag in
the saved output. See the [memory walkthrough](https://terraphim.ai/posts/cold-start-tax-agentic-memory/)
and [reviewed command-correction hooks](https://terraphim.ai/posts/native-hook-support/).
The graph and memory store are separate outputs.

## Permissions and side effects

- No credentials, executable binaries, hooks, background tasks, or telemetry are
  bundled with this plugin.
- `terraphim-grep` reads only the paths selected for a search.
- `terraphim-agent learn` writes to an existing project's `.terraphim` learning
  store, or falls back to the user's global store. Memory capture writes to the
  current user's OS-local store. Both require an explicit request to write.
- Optional model synthesis may send selected context to the model provider that
  the user configured and may incur that provider's charges. The skills keep
  synthesis disabled unless the user requests it.
- The plugin contains only Apache-2.0 Community skills. It does not include or
  unlock proprietary Core or Premium instructions.

Browse the neutral
[Community, Core, and Premium catalogue](https://terraphim-skills.md/skills/)
for other workflows. Opening the catalogue does not start checkout or payment.

Privacy policy: <https://terraphim-skills.md/legal/privacy/>

Terms of service: <https://terraphim-skills.md/legal/terms/>

Product information: <https://terraphim-skills.md/>.
The bundled [LICENSE](./LICENSE) and [NOTICE](./NOTICE) apply to this plugin.
