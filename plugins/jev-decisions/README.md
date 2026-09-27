# jev-decisions

Calibrated judgment tools for ZCode agents, built on [TypeSafe Jev](https://docs.typesafe.ai) and the community [jev-mcp](https://github.com/jkudish/jev-mcp) server.

## What it does

- Declares a `jev` MCP server (disabled by default) that exposes eleven judgment tools: `jev_verify`, `jev_screen`, `jev_noul`, `jev_find`, `jev_rerank`, `jev_classify`, `jev_decide`, `jev_compare`, `jev_extract`, `jev_review`, `jev_gate`.
- Ships a `jev-judgment` skill that teaches the agent when to reach for a judgment tool instead of answering from its own reading — adapted from the canonical skill in the `@jkudish/jev-mcp` package.

Typical uses: screen fetched or pasted text before it enters context, verify claims against cited evidence, classify support tickets against a shared catalog, pick between implementation options, review a diff before calling the task done, and gate completion claims against real test output.

## Setup

1. Install the plugin, then open its settings in ZCode.
2. Enter your **TypeSafe API key** (from the TypeSafe console) in the `TypeSafe API key` field.
3. Enable the `jev` MCP server (it ships disabled), then start a new session.
4. Ask the agent to screen untrusted text or verify a claim; the skill triggers when a judgment task appears.

## Network access, dependencies, and side effects

- When enabled, the server is started with `npx -y @jkudish/jev-mcp@0.10.0`: Node downloads that package (and its dependencies) from the npm registry on first run. The version is pinned; bump it deliberately.
- Every tool call sends the input text to the TypeSafe Jev API (configurable to other Jev-compatible providers via the server's own configuration). Inputs leave the machine — do not send secrets or private source unless policy allows it.
- Calls against the TypeSafe API are billed per input token to the API key's account; every successful result reports token usage.
- The plugin writes no files, registers no hooks, and runs no commands other than the MCP server process itself.

## Third-party components

| Component | License | Source |
| --- | --- | --- |
| `@jkudish/jev-mcp` | MIT | https://github.com/jkudish/jev-mcp |
| `jev-judgment` skill | adapted from `skills/jev` in `@jkudish/jev-mcp` (MIT) | [upstream skill](https://github.com/jkudish/jev-mcp/blob/main/skills/jev/SKILL.md) |
| TypeSafe Jev API | commercial service | https://docs.typesafe.ai |

The plugin itself is MIT.
