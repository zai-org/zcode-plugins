# glm-routing-suite: four-stage workflow + delivery gate (ZCode port)

Ported from the **measured mainline design** of router-standard v1.20 in [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) (MIT, 7k stars). Direction corrected after reading all 1293 lines of the upstream bootstrap: the value of v1.20 is not "swap personas per task" (the old design was dropped; the persona is a fixed single sentence) — it lives in two things:

1. **A four-stage progressive workflow**: understanding/alignment → planning → development → verification. Advancement is driven by completion signals (clarification / recorded plan / passing self-check / delivery check); **tool usage alone never skips a stage**. Upstream enforces this with hard tool restriction; ZCode plugins cannot, so it works here as protocol discipline plus reminders.
2. **A delivery_check evidence gate**: a mandatory local check before declaring done — file exists / non-empty / UTF-8, plus an evidence manifest (8 kinds; visuals must be `reviewed:true`; page deliverables need at least one reviewed visual; numeric invariants turn "I think it works" into "I verified it"). **This part is a complete port — pure local file validation.**

## Components

| Component | Role |
|---|---|
| `skills/mode-router` | The four-stage protocol: per-stage behavioral guidance (decide whether to ask by impact, attention reclamation, local-optima avoidance, hypothesis audit) + delivery gate usage |
| `scripts/delivery_check.py` | Delivery gate CLI: `--file <artifact> [--url <page>] --evidence evidence.json`; FAIL exits 1 |
| `scripts/router_core.py` / `route.py` | Regex task classification (build/fix/weak) — auxiliary info for reporting and stage emphasis |
| `hooks/on_prompt.py` | UserPromptSubmit hook: task echo + one-line stage-discipline reminder, fail-open |

## Quick start

```bash
# classify a task
python scripts/route.py --text "fix the login error"   # → fix (stage-0 diagnosis is the focus)

# run the gate before declaring done
python scripts/delivery_check.py --file dist/app.py --evidence evidence.json
```

Example evidence.json:

```json
{"items": [
  {"label": "main script", "kind": "file", "target": "dist/app.py"},
  {"label": "smoke run", "kind": "run", "result": "python dist/app.py --selftest → 3/3 passed"},
  {"label": "symbol count", "kind": "numeric", "result": "42"}
]}
```

## Measured-claims labeling

- **Upstream numbers** (three behavior bands, completion-signal advancement, anchor effects, 0%→100% completion): from the P1-P23 experiments of dsh-routing-suite on **DSH + DeepSeek models** (mostly n=2); **not reproduced in this port** — cited as design rationale only
- **This plugin's own tests** (2026-10-14, GLM-5.3): 34 exhaustive state-machine unit tests + 13 gate tests all pass; plus an n=20 ambiguous-task first-action A/B (10 tasks × 2 conditions × 2 reps, test/alignment-ab-results.json) — **no aggregate effect observed** (both conditions ask-first at 50%; the bare GLM-5.3 baseline is already high, a ceiling effect). The protocol's alignment benefit on GLM is **unverified** and is not claimed as a selling point

## Differences from the original (honest notes)

- Upstream enforces **hard** per-stage tool restriction via a DSH runtime injector and keeps a persistent stage section in the system prompt; ZCode plugins cannot do either, so this port relies on protocol discipline + hook reminders and model compliance
- `phase_begin` / `phase_advance` / `tools_catalog` (secondary disclosure) / goal tools / stages.json persistence are DSH tool-system specific and not ported
- `delivery_check` semantics are fully ported (v1.23-v1.28: the gate validates evidence instead of running its own browser; reviewed visuals; non-blocking numeric hint), only the interaction changes from tool call to CLI call
- Measured behavioral claims are cited from the upstream experiments on DeepSeek models, not re-verified on ZCode/GLM
- Stage state is not persisted; it lives in conversation context

## Side effects and dependencies

- **Network access: none.** Everything is local.
- **Command execution:** `python scripts/route.py`, `python scripts/delivery_check.py` (stdlib only).
- **File writes: none.** Scripts only read files and write stdout (delivery_check expresses PASS/FAIL via exit code 0/1).
- **Hooks:** one UserPromptSubmit hook, fail-open, disable via Settings → Plugins if unwanted.
- **No MCP server, no credentials, no data collection.**

## Install

Local test marketplace: Plugin Marketplace → Add → paste `C:\Users\w\Documents\z_fa\plugins` → Personal → dev-z-fa-e3f2b3e7 → glm-routing-suite → Install.

## License

MIT. Porting relationship and upstream attribution in [NOTICE](./NOTICE).
