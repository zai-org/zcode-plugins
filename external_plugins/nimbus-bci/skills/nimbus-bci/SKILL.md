---
name: nimbus-bci
description: Use when the user wants to explore public BCI/EEG datasets (MOABB, BNCI), build or validate a decoding pipeline, train a model on the hosted service, plot results, export to BIDS, or compare results on the Nimbus BCI leaderboard through the nimbus-bci MCP server.
---

# Nimbus BCI

Answer in the user's language. Use the `nimbus-bci` MCP tools and prompts:

1. Start from public datasets (MOABB / BNCI). Inspect a dataset before building a pipeline.
2. Build a pipeline, then validate it before training. Custom code is validated by the server; do not ask the user to run untrusted code locally.
3. Run hosted training, then use the plot tools to summarize results.
4. Offer BIDS export when the user needs a standard data layout.
5. Leaderboard submissions are public. Always show the user what will be submitted and get explicit confirmation before calling a leaderboard submit tool.

Scope: public offline datasets only. This plugin does not connect to EEG hardware or run live sessions on people.

If a tool returns an authorization error, ask the user to re-run the OAuth sign-in for the `nimbus-bci` server.
