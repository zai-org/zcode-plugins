# SpexCode Atlas

[中文文档](./README_CN.md)

This plugin gives ZCode one skill, `atlas`, that reads a repository into a [SpexCode](https://spexcode.net) spec tree and
draws its architecture. The result is a `.spec/` folder in the repository, with one `spec.md` per part stating what
that part is for and which file it governs, a diagram beside each node worth one, and a single HTML page that shows
the whole tree and its diagrams and opens straight from disk.

Maintained by the SpexCode authors, version 0.1.0.

## What it does

For a whole repository the skill submits one dynamic workflow (`skills/atlas/atlas.dwf.ts`) with `CreateWorkflow`.
The agent sets its language and phase names and changes nothing else. The run:

1. surveys the repository and plans its parts;
2. writes the spec for each part in parallel;
3. gates on `spex spec lint` (no errors, 90% coverage) and repairs until it passes;
4. chooses the nodes worth a picture;
5. draws each picture in parallel, each gated on `spex diagram check`;
6. has an independent reader check the top of the tree against the code, each finding re-read by another subagent;
7. commits `.spec/` and publishes the page as the run's `atlas` artifact with a report.

On a ZCode build without `CreateWorkflow`, the skill does the same job turn by turn and says so. For one node or a
subtree it draws with `spex diagram scaffold` and `spex diagram check` until each diagram passes.

## Usage

In a repository, ask for example:

- "Make a SpexCode atlas of this repository." / "给这个仓库做一份 SpexCode 图集。"
- "Draw a diagram for the session node."

## Requirements and side effects

- **Node.js 22 or newer and npm** on PATH. Nothing is installed globally: every SpexCode command runs as
  `npx -y -p spexcode@next spex <command>`, which downloads the `spexcode` package from the npm registry into npm's
  cache on first use. The page step also downloads `@spexcode/spec-dashboard`.
- **Network:** the npm registry only. No MCP server, no hooks, no remote service, no telemetry. The model is the
  one the ZCode session already uses.
- **Files written:** `.spec/` in the current repository (`spec.md` and `diagram.json` files and `.spec/spexcode.json`),
  committed to git with `.spec` as the only path, and `spexcode-atlas.html` at the repository root, left
  uncommitted. `spex spec lint` also keeps a small history cache (about 8 KB) under `~/.spexcode/projects/`.
- **Commands run:** `spex` subcommands through npx (`spec lint`, `diagram scaffold`, `diagram check`,
  `graph --public --html`, `guide`), `git add .spec` and `git commit`, and read-only inspection of the repository.
- **Cost:** the workflow runs many subagents in parallel. On psf/requests (19 source files) it took about two hours
  and 43M tokens with GLM-5.2; the runtime lowers and raises its concurrency with the model's rate limits.

## Source and license

SpexCode is MIT-licensed: <https://github.com/shuxueshuxue/spexcode>. The diagram renderer (archify) ships inside
the `spexcode` npm package.

Open a new ZCode session after enabling or updating the plugin so the Skill catalog is refreshed.
