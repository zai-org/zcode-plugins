# 🆓 MAKE ZCODE FREE — Complete Setup Guide

*Built by Tejas & ZCode on 2026-10-07. Tested end-to-end on Fedora 44. Send this file + the `skills/` folder to anyone and they can replicate the whole setup.*

---

## What you end up with

```
ZCode (default: Z.ai plan — "me")
   │  if quota dies, ZCode falls to…
   ▼
CCR Router (local, 127.0.0.1:3456)
   ├─ GPT models        (ChatGPT/Codex account login — no key needed)
   ├─ Claude models     (via OmniRoute: GitHub Copilot + Kiro pools)
   ├─ Gemini 3.x        (Google AI Studio key — FREE, no card)
   ├─ Nemotron/Gemma    (OpenRouter key — FREE models)
   └─ qwen2.5-coder:7b  (LOCAL on your own GPU — unlimited, can never run out)
```

**The promise:** you never hard-stop. If every cloud quota dies, the router silently drops to the model running on your own GPU.

---

## PART 1 — Install the router (CCR)

```bash
npm config set prefix ~/.local
npm install -g @musistudio/claude-code-router
ccr ui
```

- Management UI opens at **http://127.0.0.1:3458**
- The API gateway runs at **http://127.0.0.1:3456**
- ⚠️ After a reboot you must run `ccr ui` again (autostart not configured).

### Provider A: ChatGPT/Codex (big GPT models, no API key)
In the UI → Providers → connect your **ChatGPT account** (Codex login). You get: `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-reserve`.

### Provider B: Google Gemini (FREE — best free cloud tier)
1. Go to **https://aistudio.google.com** → sign in with Google → "Get API key" → create. No credit card.
2. CCR UI → Providers → add custom provider:
   - Type/base: `https://generativelanguage.googleapis.com/v1beta/openai` (OpenAI-compatible)
   - Paste your key. Models: `gemini-3.5-flash`, `gemini-3.8-flash`, `gemini-3.1-pro-preview`
   - Note: `gemini-2.5-pro` is retired for new users (404). Some pro models are paid-tier only.

### Provider C: OpenRouter (free models)
1. **https://openrouter.ai/keys** → sign in → Create key (real keys start `sk-or-v1-`).
2. CCR provider: base `https://openrouter.ai/api/v1`, paste key.
3. Best free models (lineup as of Oct 2026 — DeepSeek `:free` is GONE): `nvidia/nemotron-3-super-120b-a12b:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `google/gemma-4-31b-it:free`.

### Provider D: Groq (optional — fast, free)
Key from **https://console.groq.com/keys** (`gsk_...`). Base `https://api.groq.com/openai/v1`. Models: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`.
⚠️ **Known bug:** this CCR build can hang forever on Groq requests (even though the key works — verify directly first). If a test hangs, keep Groq OUT of the fallback chain until CCR updates.

### Provider E: Local unlimited fallback (the "never stop" guarantee)
```bash
# Fedora: ollama may already be installed; if not:
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5-coder:7b     # ~4.7GB, fits an 8GB GPU (RTX 3070 etc.)
```
CCR UI → Providers → add:
- Base: `http://127.0.0.1:11434/v1` (OpenAI-compatible), API key: literally `ollama`
- Model: `qwen2.5-coder:7b`
Facts: warm answers in ~0.2–2s; first call after ~5 min idle takes ~60s (model reloads into VRAM).

### Turn ON auto-fallback (critical!)
CCR UI → Routing → fallback:
- Mode: **model-chain**
- Chain (order = preference): `gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-reserve, kr/claude-sonnet-4.5, gh/claude-sonnet-5, gemini-3.5-flash, gemini-3.8-flash, nvidia/nemotron-3-super-120b-a12b:free, qwen2.5-coder:7b`
- Retry: 1

Without this, the router name is a lie — default mode is **off** and failures just error at you.

---

## PART 2 — Wire it into ZCode

Edit `~/.zcode/v2/provider_config.json` (make a backup first!). Add a provider rule:

```json
{
  "providerId": "ccr-router",
  "providerName": "CCR Router (auto-fallback)",
  "enabled": true,
  "config": {
    "access": { "type": "api-key", "apiKey": "<the local-gateway key>" },
    "api": { "type": "anthropic-messages", "baseUrl": "http://127.0.0.1:3456" },
    "personalModelIds": ["gpt-6-luna", "gemini-3.5-flash", "kr/claude-sonnet-4.5", "..."]
  }
}
```

- The gateway key lives in CCR's UI (API Keys page → "Local Gateway" key, starts `sk-ccr-`). Never share it.
- In `providerOrder`, put your main plan **first** and `ccr-router` **second**.
- Restart ZCode after edits. Pick "CCR Router" models in the session model picker when you want them.

---

## PART 3 — Bonus: OmniRoute (real Claude, free pools)

OmniRoute pools community/subscription accounts and serves an OpenAI-compatible API on **http://localhost:20128**. Your GitHub Copilot + Kiro logins unlock actual **Claude** models.

```bash
npx --legacy-peer-deps omniroute@latest     # starts server + dashboard on 20128
```

Dashboard: `http://localhost:20128/home`. Log in, connect GitHub (Copilot) and other accounts, create an API key.

**Old Claude Code flow (still works):**
```bash
# terminal 1
sudo npx --legacy-peer-deps omniroute@latest
# terminal 2
export CLAUDE_CONFIG_DIR="$HOME/.claude-omniroute"
export ANTHROPIC_BASE_URL="http://localhost:20128"
export ANTHROPIC_AUTH_TOKEN="<your omniroute key>"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_MODEL="<model alias>"
claude
```

**Wire OmniRoute into CCR/ZCode too:** add provider with base `http://127.0.0.1:20128/v1` + your omniroute key. Working models (tested): `kr/claude-sonnet-4.5` ✅, `kr/claude-haiku-4.5` ✅, `kr/deepseek-3.2` ✅, `gh/gpt-4.1` ✅, `gh/claude-sonnet-5` (rate-limited often).

**Reality check on "free Claude":** pools run on free-tier accounts that *cool down* (HTTP 429) when quota runs out. Opus/Fable-class models are gated behind paid Copilot tiers. It works, but expect pauses.

---

## PART 4 — The keys you actually need (all free)

| Key | Where | Cost |
|---|---|---|
| Google Gemini | aistudio.google.com | FREE, no card |
| OpenRouter | openrouter.ai/keys | FREE |
| Groq (optional) | console.groq.com/keys | FREE |
| Ollama local | no key at all | FREE forever |
| ChatGPT/Codex | your own login | your plan |

**Rule: everyone makes their OWN keys. Never send keys to each other — store each key in its own file in `~/Desktop/API-KEYS/` (chmod 600) with a note about status/expiry.** Dead keys we burned so we don't again: AIML API key (valid auth, zero funds), AWS Bedrock key (revoked; the long `bedrock-api-key-...` ones are 12-hour temporary tokens — always dead later), OpenRouter keys starting `sk-a4d4c...` (that was actually a local proxy token, not OpenRouter).

---

## PART 5 — Install the skills (in this folder)

Copy the `skills/` folder into `~/.agents/skills/` on the new machine:

```bash
cp -r skills/* ~/.agents/skills/
```

- **free-api-key-setup** — what to do when you get a new API key (wire it correctly, key-format cheatsheet)
- **auto-model-fallback** — what to do when a model dies (classify error → walk the chain)
- **token-counter** — run `scripts/token-usage.py` to check per-provider quota status (exits 1 when a threshold is hit → time to fall back)

---

## PART 6 — Security checklist (do not skip)

- [ ] OmniRoute dashboard: **change the default password** (`CHANGEME`) — Dashboard → Settings → Security. It listens on 0.0.0.0 by default = visible to your whole Wi-Fi network.
- [ ] Never paste API keys into chats, screenshots, or repos. Keep them in `~/Desktop/API-KEYS/` (600 perms).
- [ ] The CCR gateway key (`sk-ccr-...`) stays on your machine only.

---

## Troubleshooting — lessons we paid for

1. **"Hi" takes 1m54s** → not the router. Giant continued-session context (282K tokens) re-read cold every message (Codex backend has no prompt caching via CCR). **Fix: start fresh chats when things feel slow.**
2. **Router answers but model errors** → fallback mode was `off`. Set model-chain (Part 1).
3. **Groq hangs through CCR** (but direct API works) → known incompatibility in this CCR build; keep it out of the chain, test after CCR updates.
4. **AIML/OpenRouter-style aggregators** → a valid key with zero balance returns 403 "out of funds" on every model. Check billing first.
5. **gemini-2.5-pro 404** → retired for new accounts; use 3.x.
6. **Local model slow first message** → 60s VRAM reload after idle. Normal.
7. **Where to look when slow/broken** → CCR logs every request: `~/.claude-code-router/app-data/usage.sqlite` (table `usage_events`: model, provider, status, duration, tokens). `sqlite3` CLI isn't installed on Fedora by default — use `python3 -c "import sqlite3..."`.
