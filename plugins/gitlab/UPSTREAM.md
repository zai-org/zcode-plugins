# Upstream

This plugin imports the Agent Skills bundled in the official GitLab CLI
repository:

- Repository: https://gitlab.com/gitlab-org/cli
- Source release: `v1.112.0`
- Source commit: `816e3a52411aba73d90237859fdc6ecbc86bd169`
- Imported on: 2026-08-11
- Imported paths:
  - `internal/commands/skills/bundled/assets/glab/SKILL.md`
  - `internal/commands/skills/bundled/assets/glab-stack/SKILL.md`
- License: MIT, included in [`LICENSE`](./LICENSE)

The ZCode adaptation tracks the skills shipped by `glab v1.112.0` and adds
ZCode/Claude compatibility manifests, bilingual
marketplace documentation, `/gitlab:setup`, a shared binary/authentication
preflight, installed-version capability checks, and explicit confirmation for
destructive GitLab operations. The imported workflow content remains derived
from the official GitLab CLI source.
