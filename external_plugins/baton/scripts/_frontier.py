"""DAG + frontier — the core logic of the baton bridge.

frontier definition (authoritative):
    status == "ready" AND every ticket referenced by blocked_by has
    status == "resolved".

This is the basis of the "only dispatch frontier tickets" strategy: blocked
tickets are never claimed, so a task whose dependencies are not resolved
cannot reach the controller's claim loop. This is how the DAG problem is
solved.
"""

from __future__ import annotations

from _ticket import Ticket


def compute_frontier(tickets: list[Ticket]) -> list[Ticket]:
    """Compute the frontier: ready + all blockers resolved.

    Args:
        tickets: all tickets (sorted by num or unsorted, both fine).

    Returns:
        frontier ticket list (unsorted; callers order by num where needed).
    """
    resolved_nums = {t.num for t in tickets if t.status == "resolved"}
    frontier = [
        t
        for t in tickets
        if t.status == "ready"
        # every number in blocked_by must be resolved (empty set is a subset
        # of any set, i.e. no blockers — OK)
        and set(t.blocked_by) <= resolved_nums
    ]
    return frontier
