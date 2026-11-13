from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from .util import now_iso


CHI_WEIGHTS = {
    "ssr": 0.20,
    "rbr": 0.15,
    "pcr": 0.15,
    "icr": 0.15,
    "frs": 0.15,
    "phr": 0.10,
    "sir": 0.10,
}
SCOPE_DIMS = {
    "machine": ["ssr", "rbr", "pcr", "icr", "frs", "phr", "sir"],
    "project": ["ssr", "pcr", "icr", "frs", "phr"],
    "group": ["ssr", "pcr", "icr", "frs", "phr"],
    "hub": ["ssr", "icr", "frs", "phr"],
}
RBR_BUDGET_BYTES = 20_000
RBR_BUDGET_SKILL_CHARS = 6_000
GCR_TARGET = 0.5


def dimensions_for_scope(scope: str) -> List[str]:
    """Dimensions that enter CHI for a scope; the report must show exactly these."""
    return list(SCOPE_DIMS.get(scope) or SCOPE_DIMS["machine"])


def safe_ratio(numerator: float, denominator: float) -> Optional[float]:
    """A ratio, or None when the denominator is empty.

    An empty denominator means the run has no evidence, not a perfect score; a
    default of 1.0 would let an unmeasured scope outrank a measured one.
    """
    if denominator <= 0:
        return None
    return max(0.0, min(1.0, numerator / denominator))


def mean_available(values: Sequence[Optional[float]]) -> Optional[float]:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return sum(present) / len(present)


def percent(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(value * 100, 1)


def compute_metrics(registry: Dict[str, Any], policy_result: Dict[str, Any]) -> Dict[str, Any]:
    stats = policy_result.get("stats", {})
    governance_count = int(stats.get("governance_docs", 0))

    topic_data = registry.get("topics") or {}
    topic_total = int(topic_data.get("total", 0))
    topic_multi = int(topic_data.get("multi", 0))
    ssr = safe_ratio(topic_total - topic_multi, topic_total)

    resident_bytes = max(0, int(stats.get("resident_bytes", 0)))
    skill_chars = max(0, int(stats.get("skill_chars", 0)))
    resident_ratio = resident_bytes / RBR_BUDGET_BYTES if resident_bytes > 0 else None
    skill_ratio = skill_chars / RBR_BUDGET_SKILL_CHARS if skill_chars > 0 else None
    resident_score = None if resident_ratio is None else min(1.0, 1.0 / resident_ratio)
    skill_score = None if skill_ratio is None else min(1.0, 1.0 / skill_ratio)
    rbr = mean_available([resident_ratio, skill_ratio])
    rbr_score = mean_available([resident_score, skill_score])

    pcr = safe_ratio(
        int(stats.get("agents_dirs_compliant", 0)),
        int(stats.get("agents_dirs_total", 0)),
    )
    knowledge_icr = safe_ratio(
        int(stats.get("knowledge_indexed", 0)),
        int(stats.get("knowledge_total", 0)),
    )
    agents_icr = safe_ratio(
        int(stats.get("agents_indexed", 0)),
        int(stats.get("agents_dirs_total", 0)),
    )
    icr = mean_available([knowledge_icr, agents_icr])
    frs = safe_ratio(
        int(stats.get("state_docs_fresh", 0)),
        int(stats.get("state_docs_total", 0)),
    )
    phr = safe_ratio(
        int(stats.get("pointers_valid", 0)),
        int(stats.get("pointers_checked", 0)),
    )
    inline_bearers = int(stats.get("inline_bearers", 0))
    undeclared = int(
        stats.get("secret_undeclared_outside", stats.get("secret_outside_root", 0))
    )
    secret_bad = (
        undeclared
        + inline_bearers
        + int(stats.get("secret_in_git", 0))
        + int(stats.get("secret_tracking_unknown", 0))
    )
    secret_total = int(stats.get("secret_total", 0)) + inline_bearers
    sir = None if secret_total <= 0 else 1.0 - min(1.0, secret_bad / secret_total)
    gcr = governance_count / 8.0 if governance_count else 0.0
    gcr_score = 1.0 if gcr == 0 else min(1.0, GCR_TARGET / max(gcr, 0.01))

    dim_values: Dict[str, Optional[float]] = {
        "ssr": ssr,
        "rbr": rbr_score,
        "pcr": pcr,
        "icr": icr,
        "frs": frs,
        "phr": phr,
        "sir": sir,
    }
    raw_values: Dict[str, Optional[float]] = {
        "ssr": ssr,
        "rbr": rbr,
        "pcr": pcr,
        "icr": icr,
        "frs": frs,
        "phr": phr,
        "sir": sir,
    }
    scope = registry.get("scope", "machine")
    scope_dims = dimensions_for_scope(scope)
    scored_dims = [dim for dim in scope_dims if dim_values[dim] is not None]
    if scored_dims:
        total_weight = sum(CHI_WEIGHTS[dim] for dim in scored_dims)
        chi = sum(CHI_WEIGHTS[dim] * dim_values[dim] for dim in scored_dims) / total_weight
    else:
        chi = None

    metrics: Dict[str, Optional[float]] = {
        dim: (None if value is None else round(value, 4)) for dim, value in raw_values.items()
    }
    metrics["gcr"] = round(gcr, 4)
    scores: Dict[str, Optional[float]] = {dim: percent(value) for dim, value in dim_values.items()}
    scores["gcr"] = round(gcr_score * 100, 1)

    return {
        "generated_at": now_iso(),
        "metrics": metrics,
        "scores": scores,
        "chi": None if chi is None else round(chi * 100, 1),
        "scope": scope,
        "dims": scope_dims,
        "scored_dims": scored_dims,
        "unscored_dims": [dim for dim in scope_dims if dim not in scored_dims],
        "raw": {
            "resident_bytes": resident_bytes,
            "resident_lines": int(stats.get("resident_lines", 0)),
            "resident_entries": int(stats.get("resident_entries", 0)),
            "skill_chars": skill_chars,
            "topics_total": topic_total,
            "topics_multi": topic_multi,
            "knowledge_unhashed": int(topic_data.get("unhashed", 0)),
            "agents_dirs_total": int(stats.get("agents_dirs_total", 0)),
            "agents_dirs_compliant": int(stats.get("agents_dirs_compliant", 0)),
            "agents_dirs_missing_index": int(stats.get("agents_dirs_missing_index", 0)),
            "agents_dirs_missing_slots": int(stats.get("agents_dirs_missing_slots", 0)),
            "agents_dirs_extra_entries": int(stats.get("agents_dirs_extra_entries", 0)),
            "agents_indexed": int(stats.get("agents_indexed", 0)),
            "knowledge_total": int(stats.get("knowledge_total", 0)),
            "knowledge_indexed": int(stats.get("knowledge_indexed", 0)),
            "state_docs_total": int(stats.get("state_docs_total", 0)),
            "state_docs_fresh": int(stats.get("state_docs_fresh", 0)),
            "state_docs_fresh_declared": int(stats.get("state_docs_fresh_declared", 0)),
            "state_docs_fresh_from_git": int(stats.get("state_docs_fresh_from_git", 0)),
            "pointers_checked": int(stats.get("pointers_checked", 0)),
            "pointers_valid": int(stats.get("pointers_valid", 0)),
            "broken_pointers": int(stats.get("broken_pointers", 0)),
            "naked_pointers": int(stats.get("naked_pointers", 0)),
            "pointer_files_total": int(stats.get("pointer_files_total", 0)),
            "pointer_files_scanned": int(stats.get("pointer_files_scanned", 0)),
            "secret_total": int(stats.get("secret_total", 0)),
            "secret_outside_root": int(stats.get("secret_outside_root", 0)),
            "secret_undeclared_outside": undeclared,
            "secret_tracking_unknown": int(stats.get("secret_tracking_unknown", 0)),
            "secret_in_git": int(stats.get("secret_in_git", 0)),
            "inline_bearers": inline_bearers,
            "git_probe_failures": int(stats.get("git_probe_failures", 0)),
            "governance_docs": governance_count,
        },
    }


def metric_line(result: Dict[str, Any]) -> str:
    chi = result.get("chi")
    parts = [f"CHI {'n/a' if chi is None else chi} ({result.get('scope')})"]
    scores = result.get("scores") or {}
    for dim in result.get("dims") or []:
        value = scores.get(dim)
        parts.append(f"{dim.upper()} {'n/a' if value is None else value}")
    return " | ".join(parts)
