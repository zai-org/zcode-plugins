# polaris-memory (ZCode plugin)

POLARIS permanent-memory MCP — long-term memory for AI coding assistants.

- **Capabilities**: two-stage semantic recall (value-space ranking + hybrid
  anti-echo-chamber read), null-calibrated novelty auto-dedup, GDPR-style
  targeted forgetting, self-healing storage (quarantine + text rebuild),
  lossless cross-process shared storage.
- **Business model**: free for personal use with a **monthly quota of 1000
  searches** (calendar-month reset; write/forget/stats/health do not consume
  quota, over-quota returns -32001). Unlimited enterprise tiers via licensing.
- **Open source**: this directory ships the readable server source (v2.2.0 in
  `srv/`). A closed-source bytecode bundle is distributed separately by the
  author.

## Behavior and side effects

- **Network**: **no network requests by default** (model-free hash vectorizer,
  fully offline). A remote OpenAI-compatible embedding endpoint is only used
  when explicitly configured via `--embedding-base-url`.
- **Model/service dependencies**: optional `--embedding-model <BGE-small-zh>`
  (requires local transformers + model files; falls back to the hash
  vectorizer otherwise).
- **File writes**: memory data in `data/memory.pt` (plus `.texts` plain-text
  copy, `.quota.json` quota counter, `.log` runtime log).
- **Command execution**: ZCode starts one local Python process over stdio
  (`python srv/polaris_mcp_server.py ...`); no ports are opened unless `--http`
  is explicitly configured.
- **Tool side effects**: `polaris_write` / `polaris_auto_remember` write
  memories; `polaris_recall` consumes monthly quota; `polaris_forget` deletes.

## Requirements

Python 3.9+ with torch + numpy. Windows/macOS/Linux.

## Third-party sources and licenses

- Runtime dependencies: PyTorch (BSD-style) and NumPy (BSD 3-Clause)
- Optional semantic mode: transformers (Apache-2.0) and the BGE-small-zh model
  (BAAI, MIT; downloaded separately by the user)
- No other third-party code, assets or services

## Feedback

Issues and commercial inquiries via GitHub Issues (author: POLARIS).
