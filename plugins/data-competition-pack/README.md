# data-competition-pack

[中文文档](./README_CN.md)

An end-to-end methodology skill pack for AI data competitions (Tianchi, Kaggle and similar). One skill that carries the agent through the full lifecycle: track analysis → baseline → score pushing → model blending → submission strategy → retrospective.

## What it does

- **Six-stage workflow** (`SKILL.md`) — a repeatable competition playbook: analyze the track, build a fast baseline, push the score, blend models, plan submissions, and run a structured retrospective.
- **Overfitting diagnosis checklist** (`overfit-checklist.md`) — quick checks for LB/ CV divergence, leakage, and overfit patterns before you burn a submission.
- **Model blending guide** (`ensemble-guide.md`) — practical blending/stacking recipes with when-to-use notes.

All content is pure Markdown knowledge — no scripts, no network calls, no dependencies. The agent loads the relevant section when your conversation hits that stage.

## Structure

```text
data-competition-pack/
├── .zcode-plugin/
│   └── plugin.json
└── skills/
    └── datascience-competition/
        ├── SKILL.md
        ├── overfit-checklist.md
        └── ensemble-guide.md
```

## Side effects

| Effect | Detail |
| --- | --- |
| File reads | None beyond what the agent already reads in your project. |
| File writes | None. |
| Network | None. |
| Commands | None. Knowledge-only skill. |

## Author

wdfdsyhb · [source repository](https://github.com/wdfdsyhb/zcode-plugins-community)
