from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set

from . import __version__
from .util import human_bytes, now_iso


SEVERITY_LABEL = {
    "critical": "CRITICAL",
    "high": "HIGH",
    "medium": "MEDIUM",
    "low": "LOW",
    "info": "INFO",
}
RULE_ACTION_HINTS = {
    "secret-in-git": "rotate the exposed credential, then remove it from the git index/history",
    "secret-inline": "replace inline tokens with environment references and rotate them",
    "secret-outside-root": "register or move unregistered credential files into the canonical root",
    "secret-undeclared": "register credential files in ~/.agents/credentials/registry.md",
    "secret-missing": "rotate or drop stale credential registry rows",
    "broken-pointer": "fix the pointer path or replace it with a when-to-read pointer (`guster link` lists them)",
    "naked-pointer": "wrap naked paths in a link or inline code (CTX-03)",
    "misplaced-artifact": "move task bundles under a standard slot (`guster plan move`)",
    "stale-state": "refresh verified_at on state documents or archive them",
    "orphan-knowledge": "index knowledge files in their README, or delete them",
    "duplicate-canonical": "keep one canonical home and turn the rest into pointers",
    "skill-budget": "trim skill descriptions to one trigger sentence",
    "skill-copy-drift": "make drifted skill copies byte-identical",
    "resident-budget": "demote resident detail into knowledge or skills",
    "registry-drift": "reconcile the hub registry rows with scanned projects (CTX-10)",
    "hub-manifest-missing": "point the hub config at a real hub (`guster hub init`)",
    "note-header-malformed": "fix note front-matter (type key + machine-readable date)",
    "git-unavailable": "fix git access for the failing repositories",
    "tmp-overdue": "archive or delete overdue files in .agents/tmp",
    "governance-overlap": "reduce competing frameworks to one primary document",
    "host-manifest-drift": "synchronize plugin manifest versions",
}


def next_actions(findings: Sequence[Dict[str, Any]]) -> List[str]:
    """Actions derived from the findings that actually fired; an empty list
    keeps the baseline ritual instead of naming problems that do not exist."""
    if not findings:
        return [
            "No open findings — run `guster score` to record the baseline, and `guster check` after context edits."
        ]
    counts: Dict[str, int] = {}
    for item in findings:
        rule = str(item.get("rule") or "")
        if rule == "out-of-scope":
            continue
        counts[rule] = counts.get(rule, 0) + 1
    actions: List[str] = []
    critical_rules = sorted(
        {
            str(item.get("rule") or "")
            for item in findings
            if item.get("severity") == "critical" and item.get("rule") != "out-of-scope"
        }
    )
    if critical_rules:
        actions.append(
            f"Fix the critical finding(s) first ({', '.join(critical_rules)}); "
            "rotate any exposed credential before further edits."
        )
    seen: Set[str] = set()
    for item in findings:  # findings arrive sorted by severity
        rule = str(item.get("rule") or "")
        if rule in seen or rule == "out-of-scope":
            continue
        seen.add(rule)
        hint = RULE_ACTION_HINTS.get(rule)
        if hint is None:
            continue
        actions.append(f"`{rule}` × {counts[rule]}: {hint}.")
        if len(actions) >= 5:
            break
    actions.append(
        "Turn the rest into a checklist with `guster plan findings`; structural changes go "
        "through `guster plan move`/`guster plan init` and `guster apply <plan> --yes`."
    )
    actions.append("Re-run `guster score` after fixes and compare the trend.")
    return actions


def render_report(
    registry: Dict[str, Any],
    policy_result: Dict[str, Any],
    metric_result: Dict[str, Any],
) -> str:
    summary = registry.get("summary", {})
    metrics = metric_result.get("metrics", {})
    scores = metric_result.get("scores", {})
    raw = metric_result.get("raw", {})
    findings = policy_result.get("findings", [])
    scope = metric_result.get("scope", registry.get("scope", "machine"))
    workspaces = registry.get("workspaces", [])
    if scope == "hub":
        project_cards = summary.get("project_cards", 0)
        projects_line = f"- Projects: **{project_cards}** (scanned roots: {summary.get('projects', 0)})"
    else:
        total_projects = int(summary.get("projects", 0))
        containers = int(summary.get("containers", 0))
        projects_line = f"- Projects: **{total_projects - containers}**"
        if containers:
            projects_line += f" (workspace containers: {containers})"

    lines: List[str] = []
    lines.append("# Guster Context Health")
    lines.append("")
    lines.append(f"> Generated: {metric_result.get('generated_at', now_iso())}")
    if workspaces:
        lines.append(f"> Workspaces: {', '.join(workspaces)}")
    if registry.get("unconfigured"):
        if registry.get("auto_roots") and workspaces:
            lines.append(
                f"> **Unconfigured:** auto-scanning {', '.join(workspaces)} — "
                "run `guster init` to pin these roots."
            )
        if not registry.get("hub"):
            lines.append("> **No hub attached** — run `guster hub init` to create one.")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(projects_line)
    projects_total = int(summary.get("projects", 0))
    agents_dirs = int(summary.get("agents_dirs", 0))
    lines.append(
        f"- `.agents/` dirs: **{agents_dirs}** "
        f"(with index: {summary.get('agents_with_index', 0)}); "
        f"projects without one: {max(0, projects_total - agents_dirs)}"
    )
    lines.append(
        f"- Skills: **{summary.get('skills', 0)}** unique / "
        f"**{summary.get('skill_copies', 0)}** copies"
    )
    lines.append(
        f"- Knowledge: **{summary.get('knowledge', 0)}** files; "
        f"state: {summary.get('state', 0)}; evidence: {summary.get('evidence', 0)}"
    )
    lines.append(
        f"- Credentials: **{summary.get('secret_files', 0)}** files "
        f"({raw.get('secret_undeclared_outside', 0)} outside and unregistered, "
        f"{raw.get('inline_bearers', 0)} inline)"
    )
    lines.append("")
    lines.append("## Context Health Index")
    lines.append("")
    dims = metric_result.get("dims") or []
    label = f"{scope} scope"
    chi = metric_result.get("chi")
    lines.append(f"**CHI: {'n/a' if chi is None else chi} / 100** ({label})")
    lines.append("")
    lines.append("| Dimension | Value | Score | Raw |")
    lines.append("|---|---:|---:|---|")
    rows = [
        (
            "Single source",
            "ssr",
            metrics.get("ssr"),
            scores.get("ssr"),
            f"{raw.get('topics_total', 0) - raw.get('topics_multi', 0)}/{raw.get('topics_total', 0)} topics single-source",
        ),
        (
            "Resident budget",
            "rbr",
            metrics.get("rbr"),
            scores.get("rbr"),
            f"{human_bytes(raw.get('resident_bytes', 0))} over {raw.get('resident_entries', 0)} entry files; "
            f"skills {raw.get('skill_chars', 0)} chars",
        ),
        (
            "Placement",
            "pcr",
            metrics.get("pcr"),
            scores.get("pcr"),
            f"{raw.get('agents_dirs_compliant', 0)}/{raw.get('agents_dirs_total', 0)} compliant"
            f" ({raw.get('agents_dirs_extra_entries', 0)} extra entries, "
            f"{raw.get('agents_dirs_missing_slots', 0)} missing slots, "
            f"{raw.get('agents_dirs_missing_index', 0)} no index)",
        ),
        (
            "Index coverage",
            "icr",
            metrics.get("icr"),
            scores.get("icr"),
            f"knowledge {raw.get('knowledge_indexed', 0)}/{raw.get('knowledge_total', 0)}; "
            f".agents index {raw.get('agents_indexed', 0)}/{raw.get('agents_dirs_total', 0)}",
        ),
        (
            "State freshness",
            "frs",
            metrics.get("frs"),
            scores.get("frs"),
            f"{raw.get('state_docs_fresh', 0)}/{raw.get('state_docs_total', 0)} fresh "
            f"({raw.get('state_docs_fresh_declared', 0)} declared, "
            f"{raw.get('state_docs_fresh_from_git', 0)} from git, "
            f"{raw.get('state_docs_fresh_from_mtime', 0)} from mtime)",
        ),
        ("Pointer health", "phr", metrics.get("phr"), scores.get("phr"), f"{raw.get('pointers_valid', 0)}/{raw.get('pointers_checked', 0)} valid"),
        (
            "Secret isolation",
            "sir",
            metrics.get("sir"),
            scores.get("sir"),
            f"{raw.get('secret_undeclared_outside', 0)} undeclared outside; "
            f"{raw.get('inline_bearers', 0)} inline; {raw.get('secret_in_git', 0)} in git; "
            f"{raw.get('secret_tracking_unknown', 0)} unverifiable",
        ),
    ]
    for label, key, value, score, detail in rows:
        if dims and key not in dims:
            continue
        lines.append(
            f"| {label} | {'n/a' if value is None else value} "
            f"| {'n/a' if score is None else score} | {detail} |"
        )
    lines.append("")
    unscored = metric_result.get("unscored_dims") or []
    if unscored:
        lines.append(
            f"_No evidence: {', '.join(dim.upper() for dim in unscored)}. "
            "CHI is normalized over the dimensions that had evidence, so it is not comparable "
            "across scopes with different coverage._"
        )
        lines.append("")
    if raw.get("pointer_files_total", 0) > raw.get("pointer_files_scanned", 0):
        lines.append(
            f"_Pointer scan covered {raw.get('pointer_files_scanned')} of "
            f"{raw.get('pointer_files_total')} pointer files._"
        )
        lines.append("")
    if raw.get("knowledge_unhashed", 0):
        lines.append(
            f"_Knowledge files excluded from single-source checks (above the hash limit or unreadable): "
            f"{raw.get('knowledge_unhashed')}._"
        )
        lines.append("")
    lines.append(
        f"_Not counted in CHI: Governance simplicity {metrics.get('gcr')} "
        f"(score {scores.get('gcr')}, {raw.get('governance_docs', 0)} docs)._"
    )
    lines.append("")
    lines.append("## Findings")
    lines.append("")
    if not findings:
        lines.append("No findings.")
    else:
        counts: Dict[str, int] = {}
        for item in findings:
            counts[item["severity"]] = counts.get(item["severity"], 0) + 1
        lines.append(
            "Counts: "
            + ", ".join(
                f"{SEVERITY_LABEL.get(level, level)} {counts.get(level, 0)}"
                for level in ("critical", "high", "medium", "low", "info")
                if counts.get(level)
            )
        )
        lines.append("")
        for item in findings[:80]:
            label = SEVERITY_LABEL.get(item["severity"], item["severity"])
            lines.append(f"### [{label}] {item['title']}")
            lines.append("")
            lines.append(f"- Rule: `{item['rule']}`")
            lines.append(f"- Path: `{item['path']}`")
            lines.append(f"- {item['message']}")
            lines.append(f"- Action: {item['suggestion']}")
            evidence = item.get("evidence") or {}
            if evidence:
                compact = json.dumps(evidence, ensure_ascii=False)
                if len(compact) > 500:
                    compact = compact[:500] + "..."
                lines.append(f"- Evidence: `{compact}`")
            lines.append("")
        if len(findings) > 80:
            lines.append(f"_...and {len(findings) - 80} more findings; use `guster doctor --json`._")
            lines.append("")
    waived = policy_result.get("waived", [])
    if waived:
        lines.append(f"## Waived ({len(waived)})")
        lines.append("")
        for item in waived:
            lines.append(f"- `{item['rule']}` — `{item['path']}` — {item.get('waiver_reason', '')}")
        lines.append("")
    lines.append("## Next Actions")
    lines.append("")
    for index, action in enumerate(next_actions(findings), start=1):
        lines.append(f"{index}. {action}")
    lines.append("")
    return "\n".join(lines)


def render_status(registry: Dict[str, Any], metric_result: Optional[Dict[str, Any]] = None) -> str:
    plugin = registry.get("plugin", {})
    summary = registry.get("summary", {})
    projects = (
        summary.get("project_cards", 0)
        if registry.get("scope") == "hub"
        else summary.get("projects", 0)
    )
    lines = [
        f"Guster {plugin.get('version', '?')}",
        f"generated: {registry.get('generated_at', '?')}",
        f"hub: {registry.get('hub') or '(none)'}",
        f"workspaces: {', '.join(registry.get('workspaces', []))}",
    ]
    zones = registry.get("zones") or []
    if zones:
        lines.append(
            "zones: "
            + ", ".join(
                f"{Path(item.get('path', '.')).name}({item.get('profile', 'light')}, {item.get('tools', 0)} tools)"
                for item in zones
            )
        )
    if registry.get("unconfigured"):
        if registry.get("auto_roots") and registry.get("workspaces"):
            lines.append(
                "note: no config yet — auto-scanning "
                + ", ".join(registry["workspaces"])
                + "; run `guster init` to pin roots"
            )
        if not registry.get("hub"):
            lines.append("note: no hub attached; run `guster hub init` to create one")
    state_dir = registry.get("state_dir")
    if state_dir and Path(state_dir).parent.name == "scoped":
        lines.append(f"scope: {registry.get('scope', 'machine')} (state: {state_dir})")
    lines.extend(
        [
            f"projects: {projects}",
            f"skills: {summary.get('skills', 0)} unique / {summary.get('skill_copies', 0)} copies",
            f"knowledge: {summary.get('knowledge', 0)}",
            f"credentials: {summary.get('secret_files', 0)} files; {summary.get('inline_bearers', 0)} inline",
        ]
    )
    if plugin.get("version") and plugin.get("version") != __version__:
        lines.append(
            f"(registry was scanned by guster {plugin.get('version')}; "
            f"current CLI is {__version__} — run `guster doctor` to refresh)"
        )
    if metric_result:
        chi = metric_result.get("chi")
        stamp = metric_result.get("generated_at")
        suffix = f" (scored {stamp})" if stamp else ""
        lines.append(f"CHI: {'n/a' if chi is None else chi}{suffix}")
    return "\n".join(lines)


def redacted_registry(registry: Dict[str, Any]) -> Dict[str, Any]:
    def scrub(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: scrub(item)
                for key, item in value.items()
                if key.lower() not in {"value", "password", "token", "secret", "authorization"}
            }
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    return scrub(registry)

