---
name: aifeed
description: Verify signed AIFeed content permissions (manifest, DNS anchor, revocation) before fetching a site's content, and publish signed AIFeed origins. Use when a task involves AI content permissions, robots.txt for AI, llms.txt alternatives, signed manifests, or fetching pages served as AIFeed Markdown or MAKO.
---

# AIFeed

AIFeed is a signed alternative to `robots.txt` for AI agents. A site publishes
`/.well-known/ai.json` (Ed25519 over JCS-canonical JSON), anchors the public key in a
DNS `_aifeed` TXT record, and can revoke it. Verify before you fetch.

## Verify first

1. Call the `verify_manifest` MCP tool with the domain; require result `VERIFIED` and
   anchor `anchored` before treating permissions as authoritative.
2. Call `decide_usage` for each intended use (`retrieval`, `training`, `quote`,
   `summarize`, ...). Treat `training: deny` as binding; honor `attribution`.
3. Fetch through `fetch_aifeed` (token-budgeted) or rank pages with `select_index`;
   inspect declared assets with `list_assets` and prove them with `verify_asset`.
4. Re-check revocation on every use, not just once. If verification fails, treat the
   content as "no declared permission" and never assume allow.

## Publish

```sh
npx aifeed keygen --out .aifeed
npx aifeed site build ./public --domain example.com --key .aifeed/aifeed-private.pem --llms --inject
npx aifeed validate ./public --domain example.com
```

Then add the printed DNS TXT record, deploy the whole directory (including
`.well-known/`), and serve `Accept: text/aifeed+markdown` with an adapter from the
repository (nginx, Caddy, Apache, Node, Next.js, PHP, Python ASGI, Go, Rust, Cloudflare,
Traefik) or the `@aifeed/frameworks` build plugins. Permissions are restrict-only; never
print or commit private keys.

Specs and tooling: https://github.com/denyn1/aifeed-protocol · https://aifeed.md
