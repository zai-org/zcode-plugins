#!/usr/bin/env python3
"""Token/usage counter for the free API providers wired into ZCode.

Reads keys from ~/.zcode/v2/provider_config.json at runtime (never hard-coded,
never printed) and reports per-provider usage where the provider exposes a
usage API. For providers without one, prints their documented free-tier caps
so the fallback decision can still be made.

Usage:  python3 token-usage.py [--warn-percent 80]
Exit codes: 0 ok, 1 any provider at/over the warn threshold.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG = os.path.expanduser("~/.zcode/v2/provider_config.json")

# Documented free-tier caps for providers with no key-usage API.
# These change over time — verify at the linked console before trusting.
STATIC_QUEUES = {
    "groq": ("console.groq.com/limits", "Per-model RPM/RPD + tokens/day; no cumulative key API"),
    "gemini": ("aistudio.google.com", "Free tier: per-model RPD/TPM caps; check AI Studio usage page"),
    "mistral": ("console.mistral.ai", "Free experiment tier: 1 req/sec, 500k tokens/min, 1B tokens/month"),
}

# The only outbound endpoint this script may ever contact. Scheme and host are
# pinned; redirects are refused so the request cannot be bounced elsewhere.
OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/auth/key"
ALLOWED_HOST = "openrouter.ai"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def query_openrouter(key):
    parsed = urllib.parse.urlparse(OPENROUTER_KEY_URL)
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST:
        return {"status": "blocked: endpoint mismatch"}
    req = urllib.request.Request(
        OPENROUTER_KEY_URL,
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=10) as resp:
            if resp.status != 200:
                return {"status": f"http {resp.status}"}
            data = json.load(resp).get("data", {})
    except urllib.error.HTTPError as e:
        return {"status": f"http {e.code}"}
    except Exception as e:
        return {"status": f"query failed: {type(e).__name__}"}
    usage = data.get("usage")
    limit = data.get("limit")
    tier = "FREE" if data.get("is_free_tier") else "paid"
    rl = data.get("rate_limit") or {}
    out = {"status": "ok", "tier": tier, "rate_limit": rl}
    if isinstance(usage, (int, float)):
        out["used"] = round(usage, 4)
        if isinstance(limit, (int, float)) and limit:
            out["limit"] = limit
            out["percent"] = round(100 * usage / limit, 1)
    return out


def load_enabled_providers():
    with open(CONFIG) as f:
        d = json.load(f)
    rules = d.get("config", {}).get("providerConfigRules", {}).get("providerRules", [])
    out = []
    for r in rules:
        if not r.get("enabled"):
            continue
        cfg = r.get("config") or {}
        key = ((cfg.get("access") or {}).get("apiKey")) or ""
        if key:
            out.append({
                "id": r.get("providerId", "?"),
                "name": r.get("providerName", r.get("providerId", "?")),
                "template": r.get("templateId", ""),
                "key": key,
                "models": (cfg.get("personalModelIds") or [])[:4],
            })
    return out


def main():
    warn = 80.0
    if "--warn-percent" in sys.argv:
        warn = float(sys.argv[sys.argv.index("--warn-percent") + 1])

    providers = load_enabled_providers()
    if not providers:
        print("No enabled providers with API keys found in provider_config.json")
        return 0

    print(f"{'provider':<24} {'status':<10} {'details'}")
    print("-" * 78)
    hot = False
    for p in providers:
        ident = p["template"] or p["id"]
        if ident == "openrouter" or p["key"].startswith("sk-or-v1-"):
            info = query_openrouter(p["key"])
            if info.get("status") == "ok":
                line = f"{p['name'][:23]:<24} {'OK':<10} "
                line += f"tier={info.get('tier','?')} usage={info.get('used','?')}"
                if "limit" in info:
                    line += f"/{info['limit']} ({info['percent']}%)"
                if info.get("rate_limit"):
                    rl = info["rate_limit"]
                    line += f" rate={rl.get('requests','?')}/{rl.get('interval','?')}"
                print(line)
                if info.get("percent", 0) >= warn:
                    hot = True
                    print(f"  !! >= {warn}% of limit — consider fallback chain (auto-model-fallback skill)")
            else:
                print(f"{p['name'][:23]:<24} {'ERR':<10} {info['status']}")
        else:
            slug = next((s for s in STATIC_QUEUES if s in ident.lower()), None)
            if slug:
                where, note = STATIC_QUEUES[slug]
                models = ", ".join(p["models"]) or "-"
                print(f"{p['name'][:23]:<24} {'TRACKED':<10} caps at {where} — {note}")
                print(f"  models: {models}")
            else:
                print(f"{p['name'][:23]:<24} {'?':<10} no known usage endpoint — add one to STATIC_QUEUES")

    print("\nTip: usage shown is what the provider reports; free tiers also cap")
    print("requests/minute+day (see the auto-model-fallback skill before burning retries).")
    return 1 if hot else 0


if __name__ == "__main__":
    sys.exit(main())
