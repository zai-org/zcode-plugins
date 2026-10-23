# Ponytail for ZCode

Lazy senior dev mode for AI coding agents: **the best code is the code never
written.** Ponytail makes the agent solve the whole problem with the least new
code — skip what nobody asked for, reuse what the codebase already has, prefer
the standard library, and never add a dependency for a few lines. It stays
lazy about the solution, never about the change itself: callers, tests and
fixtures the change breaks still get finished, and validation, error handling,
security and accessibility are never cut.

This is a ZCode port of [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail)
v5.3.2 (MIT). The prompt content is kept verbatim from upstream.

## Measured impact

Upstream's published agentic benchmark (headless Claude Code, Opus 5.5, 39
tasks × 5 runs, vs. the same agent without the skill):

| Metric | Result |
|--------|--------|
| Lines of code | −53% |
| Time | −41% |
| Cost | −26% |
| Output tokens | −45% |
| Tests where the logic needs one | 98% (baseline 68%) |
| Hidden correctness/safety checks passed | 97% (baseline 96%) |

Source: `benchmarks/results/2026-10-07-agentic.md` in the upstream repo.

## What's included

**Skills** (auto-trigger by natural language, or pick from the composer's
skill picker):

| Skill | Trigger | What it does |
|-------|---------|--------------|
| `ponytail` | `/ponytail`, "be lazy", "yagni" | Lazy mode itself, levels lite / full / ultra. |
| `ponytail-review` | `/ponytail-review` | Quality review of a change: bugs, security, load, missing tests, speed, what to cut. |
| `ponytail-audit` | `/ponytail-audit` | The same review for the whole repo, ranked, max 20 findings. |
| `ponytail-debt` | `/ponytail-debt` | Harvest `shortcut:` comments into a tracked debt ledger. |
| `ponytail-gain` | `/ponytail-gain` | The measured-impact scoreboard. |
| `ponytail-help` | `/ponytail-help` | Quick reference card. |

**Commands**: `/ponytail [lite|full|ultra|off]`, `/ponytail-review`,
`/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`.

## Not ported from upstream

The Claude Code status band (`/ponytail band`), session-start auto-activation
and default-mode configuration (`PONYTAIL_DEFAULT_MODE`) are driven by
upstream's host-specific hook runtime and are not included. Activate ponytail
explicitly with `/ponytail` (or just ask for the lazy/simplest solution).

## Side effects and third-party content

None: this plugin contains Markdown prompt files only — no network access, no
API dependencies, no file writes, no command execution. Third-party content:
prompt text from [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail)
(MIT, © 2026 DietrichGebert), included with attribution.

## License

MIT, © 2026 DietrichGebert — see [LICENSE](LICENSE). Prompt content ported
verbatim from https://github.com/dietrichgebert/ponytail.
