# Cloudflare CLEF Decisions (ZCode plugin)

[中文文档](./README_CN.md)

Ported from the OpenClaw decision-provider plugin `openclaw-cloudflare-clef` (0.1.3): structured decision evaluation (boolean / choice / score) on Cloudflare Workers AI CLEF-family models, returning per-question answers with calibrated probabilities instead of free-text guesses.

- The protocol layer (`server/protocol.mjs`) is **byte-identical** to the original; all 15 protocol unit tests pass.
- The OpenClaw host integration is rewritten as a ZCode **MCP stdio server** (zero npm dependencies) exposing the tool `clef_evaluate`.
- Credentials are **DPAPI-encrypted at rest** — no plaintext on disk — filling the gap left by ZCode not shipping a secret store like OpenClaw's.

## Prerequisites (Cloudflare side)

1. **Account ID**: Cloudflare dashboard → Workers & Pages overview, right side; 32 hex characters.
2. **API Token**: dashboard avatar → My Profile → API Tokens → Create Token, permission **Workers AI → Run**, scoped to your account.

## Credentials (DPAPI-encrypted store, recommended)

Run once in PowerShell from the plugin directory (interactive, token input hidden):

```powershell
powershell -ExecutionPolicy Bypass -File server\store-secret.ps1
```

Both values are stored DPAPI-encrypted at `%USERPROFILE%\.zcode\secrets\cloudflare-clef.json`, **bound to the current Windows user** — the file is useless if copied to another machine or account, and no plaintext ever touches the disk. Re-run to rotate; delete the file to revoke.

Then **fully quit and restart ZCode**. Startup chain: `launch.mjs` decrypts the two values via PowerShell and injects them into the process environment (MCP traffic never passes through PowerShell), then loads the server.

Alternative: set user-level environment variables `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` (plaintext in the registry; not recommended). Real environment variables take precedence over the encrypted store.

Node.js ≥ 22 must be on PATH.

**Honest security boundary**: DPAPI protects against file exfiltration (backups, cloud sync, copied disks), not against other processes running as the same Windows user (Windows has no stronger non-interactive local option). Credentials and submitted evidence are never logged; logs additionally redact token/secret/api-key-style keys by pattern.

## Cost

- Workers Free is recommended: 10,000 Neurons per UTC day, hard platform limit when exhausted; the free allowance is shared with other Workers AI usage on the account.
- Workers Paid also includes the free allowance but bills beyond it; this plugin does not change your plan and does not guarantee zero spend on Paid accounts.
- Official pricing as of 2026-10-20: CLEF Flash 3,455 Neurons / M input tokens; CLEF 21,818 / M. Input-only billing.

## Usage

After installation, ask the agent to call `clef_evaluate`, for example:

```json
{
  "model": "clef-flash",
  "state": "Cargo not yet telex-released, ETA tomorrow, needs origin-port follow-up.",
  "questions": {
    "urgent": { "type": "boolean", "instructions": "Is this urgent?" },
    "route": { "type": "choice", "criteria": { "customs": "Customs clearance", "ocean": "Ocean freight" } },
    "severity": { "type": "score", "criteria": ["None", "Moderate", "Critical"] }
  }
}
```

Returns `{model, answers, usage}`; answers are keyed by the original question ids, choice/score include full probability distributions, boolean returns `probabilityTrue`. Omitting `model` uses `clef-flash`.

## Translation and boundaries (same as the original)

- boolean → noul → probabilityTrue; choice keeps all probabilities; score index objects become arrays.
- Question and option ids are remapped on the wire (Chinese and slashes allowed) and restored in results.
- Request URL is fixed to `api.cloudflare.com` (SSRF excluded by construction), redirects disabled; 55 s timeout; MCP request cancellation supported.
- No retries, no background polling, no fallback to paid models; 429 surfaces a rate-limit error (with retry-after hint).
- Text/JSON evidence plus up to 4 images (PNG/JPEG/WebP, 4 MiB each, 8 MiB total, 16 MP limit).
- Conservative input budget: UTF-8 bytes + 1,024 + 128 per alternative ≤ 24,000 (adapter-side approximation, not a vendor tokenizer).
- Response bodies are read with a 1 MiB cap.

## Verification

`node --test server/protocol.test.mjs` covers protocol translation and rejection of malformed responses (15/15 passing). MCP handshake, tools/list, missing-credential guidance, and the DPAPI store→decrypt→call chain (including a real request and 401 mapping) were smoke-tested. **Live end-to-end verification with valid credentials is pending** — after installing and storing credentials, the first real call is that verification.

## Sources

- https://developers.cloudflare.com/workers-ai/models/clef-flash/
- https://developers.cloudflare.com/workers-ai/models/clef/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
