# AdaptOrch ZCode Plugin

Connects ZCode to [AdaptOrch](https://adaptorch.com) over the remote-only `adaptorch-mcp` client for DAG topology routing, multi-model synthesis, bounded generation observations, and verifiable execution receipts.

## Requirements & Network Access

- Requires [`uv`](https://docs.astral.sh/uv/) (`uvx`) on `PATH` to launch the published PyPI package `adaptorch-mcp==0.6.3`.
- Connects over HTTPS to `https://adaptorch.com/mcp` using `ADAPTORCH_CONTROL_PLANE_TOKEN` (create a key at [adaptorch.com/app/api-keys](https://adaptorch.com/app/api-keys)).
- For model-backed runs (BYOK), set `ADAPTORCH_MCP_PROVIDER`, `ADAPTORCH_MCP_PROVIDER_MODEL`, and `ADAPTORCH_MCP_PROVIDER_API_KEY` in the host environment. Provider credentials are forwarded only on run submission headers and redacted from errors.
- No local hooks, no file writes outside standard `uvx` cache, no telemetry.

## Links

- Homepage & live Three.js OFF vs ON / math benchmarks: https://adaptorch.com/#proof
- MCP setup docs: https://adaptorch.com/mcp-docs
- Upstream source repository: https://github.com/dmae97/Adaptorch-MCP (License: Proprietary, ClassicMate)
- Research paper: https://arxiv.org/abs/2602.16873
