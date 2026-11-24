# Viralkey Plugin

Official AI Agent plugin for [Viralkey](https://viralkey.ai) (`SPARKLING LAKE TECHNOLOGIES LLC`). Connect your AI coding assistant to your Viralkey account via Remote MCP (`https://mcp.viralkey.ai/mcp`) to discover image/video models, estimate credit costs, generate AI images and videos, and retrieve finished media assets.

Works across **Cursor**, **Google Antigravity**, **GitHub Copilot**, **ZCode**, **Claude Code**, and **OpenAI Codex**.

## Features & Included Components

- **Remote MCP Server** (`https://mcp.viralkey.ai/mcp`, Streamable HTTP + OAuth 2.0 PKCE `S256` + CIMD)
  - `list_models` — List available Viralkey image and video models (`readOnly`)
  - `get_model_schema` — Inspect exact input parameters, modes, aspect ratios, and reference constraints (`readOnly`)
  - `get_account` — Read available, held, and total credits in your Viralkey wallet (`readOnly`)
  - `estimate_generation` — Validate inputs and calculate current credit cost and `revision` without reserving credits (`readOnly`)
  - `generate_image` — Submit an image generation job using your existing Viralkey credits (`request_id` idempotent)
  - `generate_video` — Submit a video generation job using your existing Viralkey credits (`request_id` idempotent)
  - `get_generation` — Poll an existing run by `run_id` (`readOnly`)
  - `list_generations` — Browse your recent model runs (`readOnly`)
  - `get_asset` — Resolve an account-owned asset ID to media metadata and signed delivery URLs (`readOnly`)
- **Agent Skill** (`skills/viralkey-media/SKILL.md`) — Guides the agent to inspect model schemas dynamically, report credit estimates before generating, preserve idempotent `request_id` / `run_id` identities on timeouts, and never leak OAuth bearer tokens to media URLs.

## Installation

### Google Antigravity
```bash
agy plugin install https://github.com/Twin-sk/viralkey-plugin
```

### Cursor
Install from the Cursor Marketplace (search **Viralkey**) or add this repository as a plugin source in Cursor Settings → Plugins.

### GitHub Copilot
Add `Twin-sk/viralkey-plugin` as a plugin marketplace repository (reads `.github/plugin/marketplace.json`).

### ZCode
Install **viralkey** from ZCode's Public Marketplace, or add `https://github.com/Twin-sk/viralkey-plugin` under **Settings → Plugins → Personal**.

### Claude Code / OpenAI Codex
```bash
# Claude Code
claude plugin marketplace add Twin-sk/viralkey-plugin
claude plugin install viralkey@viralkey-plugins

# OpenAI Codex
codex plugin marketplace add Twin-sk/viralkey-plugin
```

## Authentication & Billing

1. On first use, your MCP client discovers `https://mcp.viralkey.ai/.well-known/oauth-protected-resource/mcp` and opens your browser to authorize a single scope (`viralkey:mcp`) on `https://viralkey.ai`.
2. **No API keys or secrets are stored in this repository.**
3. **Billing & side effects**:
   - The plugin itself is free and open-source (MIT).
   - `list_models`, `get_model_schema`, `get_account`, `estimate_generation`, `get_generation`, `list_generations`, and `get_asset` are read-only and consume no credits.
   - `generate_image` and `generate_video` consume credits from your connected Viralkey wallet according to the pre-checked estimate. Subscriptions and credit top-ups are managed exclusively on [viralkey.ai](https://viralkey.ai); the MCP server cannot purchase credits, modify subscriptions, or access site admin actions.
   - Remote generation cannot read local filesystem paths directly; upload reference images through [viralkey.ai](https://viralkey.ai) first and pass the resulting account-owned asset ID.

## Network & External Dependencies

- `https://mcp.viralkey.ai/mcp` — Remote Streamable HTTP MCP endpoint and OAuth 2.0 authorization server (`/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`).
- `https://viralkey.ai/mcp/authorize/{request_id}` — Browser consent page using your existing Viralkey account session.
- `https://assets.viralkey.ai` / `https://cdn.viralkey.ai` — Signed media delivery URLs returned by `get_asset`.
- No local binaries, shell hooks, or background daemons are installed by this plugin.

## Example Prompts

- *"List available Viralkey image and video models and recommend one for a product promo."*
- *"Estimate credits and generate a 16:9 product showcase image with Viralkey."*
- *"Check my recent Viralkey generations and retrieve the finished asset link."*

## Legal, Privacy & Support

- **Website**: https://viralkey.ai
- **Privacy Policy**: https://viralkey.ai/privacy
- **Terms of Service**: https://viralkey.ai/terms
- **Support**: support@viralkey.ai
- **Company**: Sparkling Lake Technologies LLC
- **License**: [MIT](./LICENSE)
