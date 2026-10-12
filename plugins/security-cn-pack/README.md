# security-cn-pack

[中文文档](./README_CN.md)

A Chinese-language security knowledge pack for **authorized** penetration testing, public bug-bounty programs (SRC), and defensive security education. Four skills, all pure Markdown methodology documents — no exploit code, no scripts, no network calls.

> **Intended use**: security professionals and students operating within authorized engagements (e.g., China SRC platforms with explicit permission scopes) or learning defensive security. All content is publicly documented methodology; nothing here is weaponized.

## Skills

| Skill | Content |
| --- | --- |
| `src-hunter` | Bug-bounty workflow: 19 attack playbooks, 305 structured payload templates, 263 WAF-bypass variants, recon pipelines, and an 88k-entry historical vulnerability statistics set for prioritization. |
| `hw-hunter` | HW (护网) red/blue team exercise methodology: scoring rules, detection-evasion theory, incident response essentials. |
| `cnvd-cnnvd` | Submission workflows for China's national vulnerability platforms (CNVD / CNNVD): report structure, evidence requirements, scoring rules. |
| `vuln-methodology` | 11 vulnerability-class playbooks (IDOR, SSRF, deserialization, JWT attacks, …) with real case walkthroughs and tooling checklists. |

## Structure

```text
security-cn-pack/
├── .zcode-plugin/
│   └── plugin.json
└── skills/
    ├── src-hunter/        # SKILL.md + references/
    ├── hw-hunter/         # SKILL.md + references/
    ├── cnvd-cnnvd/        # SKILL.md + references/
    └── vuln-methodology/  # SKILL.md + references/
```

## Side effects

| Effect | Detail |
| --- | --- |
| File reads | None beyond the agent's normal project context. |
| File writes | None. |
| Network | None. Knowledge-only pack. |
| Commands | None. All content is Markdown documents. |

## License & attribution

MIT. Original work by wdfdsyhb · [source repository](https://github.com/wdfdsyhb/zcode-plugins-community)
