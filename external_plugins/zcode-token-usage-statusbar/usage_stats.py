# -*- coding: utf-8 -*-
"""Usage rate calculations shared by CLI and snapshots; no database or host state."""
import math

MIN_GEN_MS = 200
MAX_GEN_MS = 3_600_000


def hides_reasoning(model_id):
    return "claude" in (model_id or "").lower()


def round1(value):
    rounded = round(value, 1)
    return int(rounded) if rounded == int(rounded) else rounded


def _number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def request_stats(row):
    """Output includes reasoning. Missing/invalid generation windows stay unrated."""
    output = row["output_tokens"] or 0
    reasoning = row["reasoning_tokens"] or 0
    completed = row["completed_at"]
    thinking = reasoning > 0 or hides_reasoning(row["model_id"])
    start = row["started_at"] if thinking else row["first_token_at"]
    duration = completed - start if _number(completed) and _number(start) and completed > start else None
    reason = None
    if duration is None:
        reason = "missingGenerationWindow"
    elif not MIN_GEN_MS <= duration < MAX_GEN_MS:
        reason = "generationWindowOutOfRange"
    elif not _number(output) or output <= 0:
        reason = "noOutput"
    rated = reason is None
    ttft = row["time_to_first_token_ms"]
    return {
        "model": row["model_id"],
        "outputTokens": output,
        "reasoningTokens": reasoning,
        "ttftMs": ttft if _number(ttft) and ttft >= 0 else None,
        "genMs": duration,
        "tokPerSec": round1(output / duration * 1000) if rated else None,
        "completedAt": completed,
        "ratedOutput": output if rated else 0,
        "unratedOutput": 0 if rated else output,
        "rateUnavailableReason": reason,
    }


def aggregate_requests(items):
    """Weighted rate uses only rated output/windows, never all output as numerator."""
    items = list(items)
    rated = [item for item in items if item["tokPerSec"] is not None]
    output = sum(item["outputTokens"] for item in items)
    rated_output = sum(item["outputTokens"] for item in rated)
    duration = sum(item["genMs"] for item in rated)
    return {
        "requests": len(items),
        "rated": len(rated),
        "unrated": len(items) - len(rated),
        "totalOutput": output,
        "totalReasoning": sum(item["reasoningTokens"] for item in items),
        "ratedOutput": rated_output,
        "unratedOutput": output - rated_output,
        "rateCoverage": rated_output / output if output > 0 else None,
        "genMs": duration,
        "tokPerSec": round1(rated_output / duration * 1000) if rated else None,
        "peak": max((item["tokPerSec"] for item in rated), default=None),
    }
