---
name: free-api-key-setup
description: Wire a free API key (OpenRouter, Groq, Gemini, Mistral, any OpenAI-compatible) into ZCode as a usable model provider. Use when Tejas hands over an API key and says which provider it's for, or asks to make ZCode usable for free / add a provider.
---

# Free API Key → ZCode Provider Setup

Tejas hands over an API key and names the provider. The goal: add it to ZCode's
provider config so a free model can be selected. Do it all yourself — he only
supplies the key and the provider name.

## Hard rules

- **Never echo the key** into chat, memory files, skills, or any file that
  leaves the machine. It goes into exactly one place: `provider_config.json`.
- **Back up first**: `cp ~/.zcode/v2/provider_config.json ~/.zcode/v2/provider_config.json.bak`
- Edit with **python json** (load → modify → dump), never sed/hand-edit.
- Config is read at session start — after editing, the ZCode session must be
  **restarted** (or the provider switched via the client UI) to take effect.

## The config file

`~/.zcode/v2/provider_config.json` — schema:

```json
{
  "schemaVersion": 1,
  "config": {
    "providerOrder": ["<providerId>", ...],        // must contain the id, order = UI order
    "providerConfigRules": {
      "providerRules": [
        {
          "providerId": "unique-id",
          "providerName": "Display Name",
          "enabled": true,                          // REQUIRED true; entries without it may not show
          "templateId": "openrouter",               // ONLY for built-in templates (openrouter etc.)
          "config": {
            "group": "standard-personal",
            "access": { "type": "api-key", "apiKey": "<KEY>" },
            "api": { "type": "<see table>", "baseUrl": "<endpoint>" },  // custom endpoints only
            "personalModelIds": ["<model-id>"],     // shown in picker
            "modelOrder": ["<model-id>"]
          }
        }
      ]
    }
  }
}
```

## Provider identification (key prefix → recipe)

| Key prefix | Provider | How to wire |
|---|---|---|
| `sk-or-v1-…` | OpenRouter | Flip `enabled: true` on the existing `openrouter` rule (template-backed, no baseUrl needed). Get free model ids from `https://openrouter.ai/api/v1/models` (filter `pricing.prompt == "0"`), put a few in `personalModelIds` + `modelOrder`. |
| `gsk_…` | Groq | New rule, `api: {type: "openai-chat", baseUrl: "https://api.groq.com/openai/v1"}`, models like `llama-3.3-70b-versatile` (check /models). |
| `AIza…` | Google Gemini | **Gotcha: use the OpenAI-compatible endpoint** `https://generativelanguage.googleapis.com/v1beta/openai/` with the **openai-chat** api type — an old attempt used `anthropic-messages` against this URL and failed. Models: `gemini-2.5-flash`, `gemini-2.5-pro`. |
| `sk-…` (other) | Ask Tejas which service; it's OpenAI-compatible or Anthropic-compatible. | OpenAI-compatible → `openai-chat` + their baseUrl; Anthropic-compatible → `anthropic-messages` + baseUrl. |
| `…` Mistral `…` | Mistral | `api: {type: "openai-chat", baseUrl: "https://api.mistral.ai/v1"}`, model `mistral-large-latest`. |

If the `api.type` guess is wrong for a custom endpoint (provider errors on
first test), try the other type (`openai-chat` ⇄ `anthropic-messages`) before
assuming the key is bad.

## Steps

1. Confirm with Tejas: which provider is this key for? (Or detect from prefix.)
2. Back up the config file.
3. Load JSON, apply the recipe above (enable existing rule OR append new rule),
   make sure `providerId` is in `providerOrder`, validate the JSON parses.
4. Write the file. Never print the key in the command output — mask it.
5. Tell Tejas to **restart the ZCode session** (or pick the provider in
   Settings → model picker), then select a model from the new provider.
6. First message on the new model = the verification test. If it errors:
   read the error (wrong api.type? wrong model id? rate limit?), fix, retry.

## Gotchas learned

- Free tiers rate-limit hard — if requests 429, that's the tier, not the setup.
- Keep the existing Z.ai plan entry untouched as the fallback provider.
- `credentials.json` in the same folder is separate — don't touch it.
- After any provider change, note in memory what worked (api.type + baseUrl +
  a model id) so the next setup is instant.
