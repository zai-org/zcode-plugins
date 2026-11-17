---
name: token-counter
description: Check how much of each free API provider's quota Tejas has burned — live usage where the provider exposes an API, documented free-tier caps where it doesn't. Use when Tejas asks about token usage, free-tier limits, "how much left", before long sessions on free keys, or when rate-limit errors (429) start appearing.
---

# Token Counter (free API keys & models)

## Run it

```bash
python3 ~/.agents/skills/token-counter/scripts/token-usage.py
# warn threshold:  python3 …/token-usage.py --warn-percent 60
```

Reads keys from `~/.zcode/v2/provider_config.json` at runtime — keys are never
printed, logged, or stored anywhere else. Exit code 1 = any provider at/over
the warn threshold.

## How to read the output

- **OK + usage/limit + %** — provider reports real numbers (OpenRouter via
  `GET /api/v1/auth/key`: credits used, limit, free/paid tier, rate limit).
- **TRACKED** — provider has no cumulative usage API; the script shows the
  documented free-tier caps and where to verify (console link). Numbers there
  change over time — re-verify before trusting.
- **ERR** — key rejected or network issue; distinguish 401 (dead key →
  re-wire per free-api-key-setup) from 429 (throttled → just wait or switch).

## Decision wiring

- Usage ≥ warn threshold, or repeated 429s → follow the **auto-model-fallback**
  skill: walk the chain (zai plan → openrouter free → groq → gemini → mistral).
- A provider at 100% isn't "broken" — it's exhausted until its reset window.
  Don't burn retries; switch.
- Before long sessions on free keys, run this first and pick a provider with
  headroom.

## Free-tier facts (verify — these drift)

- **OpenRouter free models**: ~20 req/min; daily request cap depends on
  account balance (50/day under $10 balance, 1000/day at ≥$10). Free models
  cost 0 credits, so `/key` usage may stay 0 while request caps still apply.
- **Gemini free tier**: per-model caps (e.g. flash tier: small RPM, ~hundreds
  of requests/day) — check aistudio.google.com.
- **Groq**: per-model RPM/RPD + tokens/day — console.groq.com/limits.
- **Mistral free tier**: 1 req/s, 500k tokens/min, 1B tokens/month.

## Extending

New provider with a usage API → add a pinned-URL query function in
`scripts/token-usage.py` (https only, exact-host check, redirects disabled —
Mimosa enforces this). New provider without one → add it to `STATIC_QUEUES`.
