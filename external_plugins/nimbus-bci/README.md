# nimbus-bci

[中文文档](./README_CN.md)

Connects ZCode to the hosted [Nimbus BCI](https://docs.nimbusbci.com) MCP server, an Apache-2.0 toolkit for brain-computer interface (BCI) and EEG decoding research on public datasets.

## What it provides

- **MCP server `nimbus-bci`** (remote, Streamable HTTP): `https://nimbus-mcp.fly.dev/mcp`, with 63 tools and 5 prompts (nimbus-mcp 0.14.20):
  - browse and load public MOABB / BNCI datasets;
  - build and validate decoding pipelines;
  - hosted model training;
  - plots of data and results;
  - BIDS export;
  - a public results leaderboard.
- **Skill `nimbus-bci`**: guides the agent through the dataset → pipeline → validate → train → plot workflow and requires confirmation before any public leaderboard submission.

## Authentication

The server handles sign-in with OAuth. On first use ZCode opens the Nimbus authorization page in your browser. The plugin contains no API keys or other secrets, and nothing needs to be configured.

## Network access and side effects

- All tool calls go over HTTPS to `nimbus-mcp.fly.dev`, operated by Nimbus BCI. Datasets are fetched and training runs on that hosted service, not on your machine.
- The plugin writes no local files and ships no hooks, commands or local executables.
- Leaderboard submissions are publicly visible.
- Scope: public offline datasets only. The plugin does not connect to EEG hardware or run live sessions on people.

## Links

- Source: <https://github.com/nimbusbci/nimbus-mcp> (Apache-2.0)
- PyPI: [`nimbus-mcp`](https://pypi.org/project/nimbus-mcp/) 0.14.20 (local stdio alternative)
- Docs: <https://docs.nimbusbci.com>
- Contact: hello@nimbusbci.com

## License

Apache License 2.0. Public datasets accessed through the server keep their own licenses.
