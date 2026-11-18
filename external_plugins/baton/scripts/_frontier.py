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


def is_frontier_ticket(status: str, blocked_by: list[int], resolved_nums: set[int]) -> bool:
    """The frontier judgment shared by the board and the claim loop.

    ``status`` is the ticket's own status, ``resolved_nums`` the set the
    caller considers resolved; ``blocked_by`` may come from another view of
    the same ticket (the claim loop reads status from tasks.md and blockers
    from the plan revision).
    """
    return status == "ready" and set(blocked_by) <= resolved_nums


def compute_frontier(tickets: list[Ticket]) -> list[Ticket]:
    """Compute the frontier: ready + all blockers resolved.

    Args:
        tickets: all tickets (sorted by num or unsorted, both fine).

    Returns:
        frontier ticket list (unsorted; callers order by num where needed).
    """
    resolved_nums = {t.num for t in tickets if t.status == "resolved"}
    return [
        t
        for t in tickets
        if is_frontier_ticket(t.status, t.blocked_by, resolved_nums)
    ]
