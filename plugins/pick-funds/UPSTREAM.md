# Upstream

This plugin is vendored from Z.ai's upstream financial-services plugin project.
Its `agents/`, `commands/` and `skills/` are produced there — the
`report-render`, `xlsx-author` and `audit-xls` skills and every agent's
guardrail block are generated upstream from a single source, and upstream's
build fails if a vendored copy diverges. Do not edit those directories here: an
edit is invisible to that check and is overwritten on the next sync.

| | |
|---|---|
| Upstream version | `0.8.1` |
| Upstream author | `Z.ai` |
| Published version | `0.1.1` |
| Vendored from commit | `bcca8301b92f8218a6ab5c1f3fafea360512fac7+dirty` |

## Owned by this repository

The ZCode adaptation layer is maintained here rather than upstream, and has to
survive the next sync:

- `.zcode-plugin/plugin.json` — the ZCode-first manifest, including the
  `mcpServers` block and its `auth: zcode_official` declarations
- `.claude-plugin/plugin.json` — the compatibility manifest, with `mcpServers`
  deliberately absent, because those servers only resolve inside ZCode
- `README.md` and `README_CN.md`
- the matching entry in the repository-root `marketplace.json`

To change a vendored component, change it upstream, let upstream's checks pass,
then re-run the vendoring sync from the upstream project.

## Open publishing gates

- The recorded source commit carries a `+dirty` suffix, so the vendored content
  does not correspond to any committed upstream state and cannot be reproduced
  from that hash alone. Re-vendor from a clean commit before publishing.

- Neither the upstream project nor this directory declares a license, and the
  manifest has no `license` field. The licensing of the vendored components is
  unresolved.
