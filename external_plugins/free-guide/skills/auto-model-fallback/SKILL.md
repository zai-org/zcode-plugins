---
name: auto-model-fallback
description: Automatically recover when the active ZCode model breaks — rate limits, dead keys, provider outages, removed models. Use when Tejas says a model isn't working, requests fail, "switch model", or when tool calls start erroring with model/provider errors. Covers the zero-software playbook and the claude-code-router auto-failover setup.
---

# Auto Model Fallback

Goal: a broken model should never stall Tejas for more than one message.

## Level 1 — In-session recovery playbook (no extra software)

When model errors appear, classify then act:

| Error pattern | Meaning | Action |
|---|---|---|
| 429 / rate_limit / quota | Free tier exhausted | Don't retry more than once — switch model |
| 401 / invalid api key | Key dead or rotated | Re-wire key (see free-api-key-setup skill), else switch |
| 404 / model not found | Model id removed/renamed | Pick another id from same provider |
| 5xx / overloaded / timeout ×2 | Provider outage | Switch provider, note outage in memory |
| Empty/garbage replies | Model unusable for coding | Switch to a stronger fallback |

**Switch procedure:**
1. Read `~/.zcode/v2/provider_config.json` — list `enabled: true` providers and
   their `personalModelIds` / `modelOrder`.
2. Walk this fallback chain (first ALIVE wins):
   `zai plan (GLM-5.3-Flash, PRIMARY — Tejas wants to stay on this)` →
   `ccr-router provider (auto-falls through: gpt-5.6-terra → gpt-5.6-luna → gpt-5.5 → gpt-reserve → qwen2.5-coder:7b LOCAL via ollama 127.0.0.1:11434, unlimited)`
   (openrouter key stored is wrong format, groq/gemini/mistral have no keys yet — chain grows as Tejas adds providers; keep this list updated).
3. Tell Tejas exactly what to pick in the model picker (one tap), or flip
   `enabled` flags / model ids per the free-api-key-setup skill and have him
   restart the session.
4. After recovery, record in memory: which provider broke, the error, the date.
   If the same provider dies 3× in a week, recommend Level 2.

## Level 2 — True automatic switching: claude-code-router (recommended)

Proven pattern (37k★, musistudio/claude-code-router): ONE stable local endpoint
that hides many providers behind it with **retries, key rotation, and ordered
fallback models**. Model breakage becomes invisible — the router silently
serves the next working model.

Install (Fedora, Node 22 present):
```bash
npm install -g @musistudio/claude-code-router
ccr ui   # management UI at http://127.0.0.1:3458, gateway at http://127.0.0.1:3456
```
Setup:
1. In the UI → Providers → add each free provider + API key (OpenRouter,
   Groq, Gemini, Mistral — it speaks their protocols natively).
2. Routing → set the fallback chain (primary → fallbacks, ordered).
3. ZCode side: add ONE custom provider entry per the free-api-key-setup skill:
   `api: { "type": "anthropic-messages", "baseUrl": "http://127.0.0.1:3456" }`,
   any apiKey (CCR accepts configured client keys), model ids matching what
   the router exposes.
4. Auto-start at login (user systemd unit or KDE autostart .desktop running
   `ccr start`); health check: `curl -s http://127.0.0.1:3456/ >/dev/null && echo alive`.

Result: Tejas stays on ONE model entry forever; failures route automatically.

## Level 2 alternative — LiteLLM proxy (OpenAI-compatible chains)

For pure OpenAI-format providers, `litellm --config config.yaml` with:
```yaml
router_settings:
  fallbacks:
    - primary-model: ["fallback-1", "fallback-2"]
  rate_limit_error_fallbacks:      # triggers on 429
    - primary-model: ["fallback-1"]
```
Point the ZCode provider's baseUrl at the local LiteLLM port
(`http://0.0.0.0:4000/v1`, api type `openai-chat`).

## Hygiene

- Keys only ever go into `provider_config.json` / router config — never chat,
  memory, or git.
- Free tiers 429 a lot: the chain exists for that, don't fight a throttled
  provider with retries.
- After any failover that required manual work, update this skill's chain and
  note the outage in memory.
