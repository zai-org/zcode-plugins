# free-guide

[中文文档](./README_CN.md)

Community guide plugin for the ZCode plugins marketplace: everything needed to run ZCode
on a **free stack** — tested end-to-end on Fedora 44 by Tejas Lowanshi & ZCode (2026-10-07).

## What it gives you

A quota-safe fallback chain, so a session never hard-stops when a cloud quota dies:

```
ZCode (default: Z.ai plan)
   │  if quota dies, falls to…
   ▼
CCR Router (local, 127.0.0.1:3456)
   ├─ GPT models        (ChatGPT/Codex account login — no key needed)
   ├─ Claude models     (via OmniRoute: GitHub Copilot + Kiro pools)
   ├─ Gemini 3.x        (Google AI Studio key — FREE, no card)
   ├─ Nemotron/Gemma    (OpenRouter key — FREE models)
   └─ qwen2.5-coder:7b  (LOCAL on your own GPU — unlimited)
```

## Files

- **`docs-guide.md`** — the complete setup guide (read this first)
- **`skills/free-api-key-setup/`** — wire any new API key into ZCode correctly
- **`skills/auto-model-fallback/`** — auto-switch to the next provider on quota/auth errors
- **`skills/token-counter/`** — track how much of each provider's quota you have burned
- **`README-FIRST.txt`** — one-page quick start

## Skills overview

| Skill | Trigger | What it does |
| --- | --- | --- |
| `free-api-key-setup` | you hand the agent a new API key | Provider schema, key-prefix table, `api.type` gotchas; never echoes the key |
| `auto-model-fallback` | model errors (429/401/404/5xx) | Classifies and walks the fallback chain; optional claude-code-router for true auto-switching |
| `token-counter` | "how much quota left" | Live usage where the provider exposes an API, documented caps where it doesn't; exits 1 at warn threshold |

## Disclaimer

Free tiers and model lineups change often — the guide was accurate for October 2026 and
notes which specifics to re-check (e.g. DeepSeek `:free` was already gone, `gemini-2.5-pro`
retired for new users). Provider caps live inside the skills so they can be updated
without touching the guide.

## Install

Inside ZCode: Plugin Marketplace → search **free-guide** → install. Or test from source:

```bash
git clone https://github.com/zai-org/zcode-plugins
cd zcode-plugins
pnpm install --frozen-lockfile && pnpm build
# add dist/local-marketplace via Plugin Marketplace → New
```

## Author

Built by **Tejas Lowanshi** ([@Tejs2005](https://github.com/Tejs2005)) with ZCode, as the
"send this to anyone" bundle for the free AI stack. Apache-2.0 like the rest of this repo.
