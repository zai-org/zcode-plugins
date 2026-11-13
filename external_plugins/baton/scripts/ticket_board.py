#!/usr/bin/env python3
"""ticket_board.py — local board generator over OpenSpec changes.

The plan face is OpenSpec: every change lives at
``openspec/changes/<change-id>/tasks.md``. This tool is read-only observability
plus a thin check/uncheck helper — to add/remove/reorder tasks, edit tasks.md
directly (baton picks the change up as a new plan revision on the next run).

Usage:
    python3 scripts/ticket_board.py scan <project> [<change-id>]  # id optional when
    python3 scripts/ticket_board.py build <project> [<change-id>]  # exactly one change
    python3 scripts/ticket_board.py build-all <project>
    python3 scripts/ticket_board.py check <project> <change-id> <N.M> [--dry-run]   # flip [ ]→[x]
    python3 scripts/ticket_board.py uncheck <project> <change-id> <N.M> [--dry-run] # flip [x]→[ ]

Both flips echo ``reverse`` — the exact command that undoes them — because
tasks.md is the run's audit record; ``--dry-run`` runs the same validation
and previews the flip without writing tasks.md or board.json. Every real
write that regenerates board.json (check/uncheck/scan) also rewrites any
already-built board.html / board-all.html in place, so reloading the open
board shows the fresh state without a manual rebuild.
"""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _ticket import (  # noqa: E402
    TasksMarkdownError,
    check_task,
    parse_tasks_md,
    uncheck_task,
    validate_change_id,
)
from _frontier import compute_frontier  # noqa: E402
from orchestration.plan_model import utc_now  # noqa: E402


def _tasks_path(project: str | Path, feature: str) -> Path:
    return (
        Path(project).resolve()
        / "openspec"
        / "changes"
        / validate_change_id(feature)
        / "tasks.md"
    )


def _board_path(project: str | Path, feature: str) -> Path:
    return Path(project).resolve() / ".dsh" / "baton" / validate_change_id(feature) / "board.json"


def scan_board(project: str | Path, feature: str) -> dict:
    """Walk the change's tasks.md and produce a board data dict."""
    try:
        tasks_path = _tasks_path(project, feature)
        tickets = parse_tasks_md(tasks_path)
    except (TasksMarkdownError, ValueError) as exc:
        return {"error": str(exc)}

    frontier_set = {t.num for t in compute_frontier(tickets)}

    ticket_dicts = []
    stats: dict[str, int] = {"total": len(tickets)}
    for t in tickets:
        ticket_dicts.append({
            "num": t.num,
            "task_id": t.task_id,
            "title": t.title,
            "status": t.status,
            "blocked_by": list(t.blocked_by),
            "section": t.section,
            "file": "tasks.md",
            "what_to_build": t.what_to_build[:200],
            "is_frontier": t.num in frontier_set,
            "progress": 1.0 if t.status == "resolved" else 0.0,
            "feature": feature,
        })
        stats[t.status] = stats.get(t.status, 0) + 1

    ticket_dicts.sort(key=lambda x: x["num"])

    return {
        "feature": feature,
        "project": str(Path(project).resolve().name),
        "project_path": str(Path(project).resolve()),
        "generated_at": utc_now(),
        "stats": stats,
        "frontier": sorted(frontier_set),
        "tickets": ticket_dicts,
    }


def save_board(project: str | Path, feature: str) -> dict:
    board = scan_board(project, feature)
    if "error" not in board:
        path = _board_path(project, feature)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return board


def _list_changes(project: str | Path) -> list[str]:
    """Every non-archived change that has a tasks.md."""
    changes_dir = Path(project).resolve() / "openspec" / "changes"
    if not changes_dir.is_dir():
        return []
    return sorted(
        child.name
        for child in changes_dir.iterdir()
        if child.is_dir() and child.name != "archive" and (child / "tasks.md").is_file()
    )


def _sole_change(project: str | Path) -> tuple[str | None, str | None]:
    """Resolve an omitted <change-id> to the project's single change.

    Returns ``(feature, error)``. Exactly one change with a tasks.md → that
    id. Zero → an error naming the searched dir; more than one → an error
    listing the candidates so the caller can pass one explicitly.
    """
    changes = _list_changes(project)
    if len(changes) == 1:
        return changes[0], None
    changes_dir = Path(project).resolve() / "openspec" / "changes"
    if not changes:
        return None, (
            f"no change id given and no OpenSpec changes with tasks.md "
            f"found under {changes_dir}"
        )
    preview = ", ".join(changes[:5]) + ("…" if len(changes) > 5 else "")
    return None, (
        f"no change id given and {len(changes)} changes found ({preview}); "
        f"pass one explicitly"
    )


def scan_all(project: str | Path) -> dict:
    """Scan every change in the project and merge into a multi-change board.

    A change whose tasks.md fails to parse is reported under
    ``skipped_changes`` (feature + error) instead of silently vanishing from
    the board; the healthy changes still get a board.
    """
    all_tickets: list[dict] = []
    feature_summaries: list[dict] = []
    skipped_changes: list[dict] = []

    for change in _list_changes(project):
        board = scan_board(project, change)
        if "error" in board:
            skipped_changes.append({"feature": change, "error": board["error"]})
            continue
        all_tickets.extend(board["tickets"])
        s = board["stats"]
        feature_summaries.append({
            "feature": change,
            "total": s.get("total", 0),
            "resolved": s.get("resolved", 0),
            "ready": s.get("ready", 0),
            "frontier": len(board["frontier"]),
        })

    stats: dict[str, int] = {"total": len(all_tickets)}
    for t in all_tickets:
        stats[t["status"]] = stats.get(t["status"], 0) + 1

    all_tickets.sort(key=lambda x: (x["feature"], x["num"]))

    return {
        "feature": "(all)",
        "features": feature_summaries,
        "skipped_changes": skipped_changes,
        "project": str(Path(project).resolve().name),
        "project_path": str(Path(project).resolve()),
        "generated_at": utc_now(),
        "stats": stats,
        "frontier": [t["num"] for t in all_tickets if t.get("is_frontier")],
        "tickets": all_tickets,
    }


def save_board_all(project: str | Path) -> dict:
    """Scan every change and persist ``board-all.json``.

    The json (and the ``.dsh/baton/`` tree) is written only when the scan
    has something to record — tickets, or skipped changes as parse-failure
    evidence. A pure-empty project (no changes with tasks.md) is an empty
    state, not a board: writing an all-empty artifact there would leave a
    stray file that reads as broken output on a failing exit.
    """
    board = scan_all(project)
    if board.get("tickets") or board.get("skipped_changes"):
        path = Path(project).resolve() / ".dsh" / "baton" / "board-all.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return board


def _reverse_command(project: str | Path, feature: str, task_id: str, checked: bool) -> str:
    """The exact CLI invocation that undoes a flip of ``task_id``."""
    verb = "uncheck" if checked else "check"
    return " ".join([
        "python3",
        shlex.quote(str(Path(__file__).resolve())),
        verb,
        shlex.quote(str(project)),
        shlex.quote(feature),
        task_id,
    ])


def set_task_checked(
    project: str | Path, feature: str, task_id: str, checked: bool, dry_run: bool = False
) -> dict:
    """Flip (or preview flipping) one task's checkbox (``N.M`` id).

    ``dry_run=True`` runs the same validation but writes nothing; every
    success — real or preview — carries ``reverse``, the command that undoes
    the flip.
    """
    from _ticket import task_num

    parts = task_id.split(".")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        return {"error": f"task id must look like N.M (e.g. 2.1), got: {task_id!r}"}
    try:
        num = task_num(int(parts[0]), int(parts[1]))
    except ValueError as exc:
        return {"error": str(exc)}
    reverse = _reverse_command(project, feature, task_id, checked)
    try:
        tasks_path = _tasks_path(project, feature)
    except ValueError as exc:
        return {"error": str(exc)}
    if dry_run:
        try:
            tickets = parse_tasks_md(tasks_path)
        except TasksMarkdownError as exc:
            return {"error": str(exc)}
        ticket = next((t for t in tickets if t.num == num), None)
        if ticket is None:
            return {"error": f"task {task_id} not found in {tasks_path}"}
        if checked:
            if ticket.status == "resolved":  # check_task is idempotent
                return {"task": task_id, "action": "no-op", "current": "resolved",
                        "dry_run": True, "reverse": reverse}
            return {"task": task_id, "action": "would check", "current": "ready",
                    "dry_run": True, "reverse": reverse}
        if ticket.status != "resolved":  # mirrors the real uncheck error
            return {"error": f"task {task_id} is not checked"}
        return {"task": task_id, "action": "would uncheck", "current": "resolved",
                "dry_run": True, "reverse": reverse}
    if checked:
        try:
            check_task(tasks_path, num)
        except TasksMarkdownError as exc:
            return {"error": str(exc)}
        return {"task": task_id, "action": "checked", "reverse": reverse}
    try:
        uncheck_task(tasks_path, num)
    except TasksMarkdownError as exc:
        return {"error": str(exc)}
    return {"task": task_id, "action": "unchecked", "reverse": reverse}


def _print(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_scan(args):
    if args.feature is None:
        args.feature, err = _sole_change(args.project)
        if err:
            _print({"error": err})
            return 1
    board = save_board(args.project, args.feature)
    if "error" in board:
        _print(board)
        return 1
    refreshed = _refresh_built_boards(args.project, args.feature, board)
    if refreshed:
        board["boards_refreshed"] = refreshed
    _print(board)
    return 0


def cmd_check(args):
    result = set_task_checked(args.project, args.feature, args.task, True, dry_run=args.dry_run)
    return _finish_flip(args, result)


def cmd_uncheck(args):
    result = set_task_checked(args.project, args.feature, args.task, False, dry_run=args.dry_run)
    return _finish_flip(args, result)


def _finish_flip(args, result: dict) -> int:
    """Print the flip result; a real write also refreshes every built board.

    The board's copy-paste workflow ends with the user reloading the browser
    tab they copied the command from, so the flip itself must bring the
    already-built board.html files back in sync with the fresh board.json.
    """
    if "error" in result:
        _print(result)
        return 1
    if not args.dry_run:
        board = save_board(args.project, args.feature)
        if "error" not in board:
            refreshed = _refresh_built_boards(args.project, args.feature, board)
            if refreshed:
                result["boards_refreshed"] = refreshed
    _print(result)
    return 0


def _refresh_built_boards(project: str | Path, feature: str, board: dict) -> list[str]:
    """Rewrite already-built HTML boards that a fresh board.json made stale.

    A built board.html bakes its data in at build time, so a flip that
    regenerates board.json leaves every open board frozen on the old state.
    The feature's board.html is re-rendered from ``board``; a global
    board-all.html, whose data spans every change, is re-rendered from a
    fresh scan_all. Boards never built are not created here — building stays
    an explicit choice. Returns the paths rewritten.
    """
    base = Path(project).resolve() / ".dsh" / "baton"
    refreshed: list[str] = []
    feature_html = base / validate_change_id(feature) / "board.html"
    if feature_html.is_file():
        feature_html.write_text(_render_html(board), encoding="utf-8")
        refreshed.append(str(feature_html))
    all_html = base / "board-all.html"
    if all_html.is_file():
        merged = scan_all(project)
        if merged.get("tickets"):  # never regress the global board to empty
            all_html.write_text(_render_html(merged), encoding="utf-8")
            refreshed.append(str(all_html))
    return refreshed


def _json_for_html(board: dict) -> str:
    """JSON encoded for embedding inside the template's ``<script>`` element.

    ``json.dumps`` leaves ``<``, ``>`` and ``&`` untouched, so a task title
    that literally contains ``</script>`` (ordinary text in a web project's
    tasks.md) would terminate the script element mid-JSON: the board renders
    empty and the trailing title text becomes live markup. Escaping them as
    ``\\uXXXX`` keeps the blob valid JSON and inert in HTML.
    """
    return (
        json.dumps(board, ensure_ascii=False, indent=2)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )


def _tool_cmd() -> str:
    """The runnable command prefix that reaches this script from any cwd."""
    return f"python3 {shlex.quote(str(Path(__file__).resolve()))}"


def _render_html(board: dict) -> str:
    template_path = SCRIPT_DIR.parent / "templates" / "ticket-board.html"
    html = template_path.read_text(encoding="utf-8")
    return (
        html.replace("__BOARD_DATA__", _json_for_html(board))
        # _json_for_html on a plain string yields a quoted JS literal, markup-escaped
        .replace("__TOOL_CMD__", _json_for_html(_tool_cmd()))
    )


def cmd_build(args):
    if args.feature is None:
        args.feature, err = _sole_change(args.project)
        if err:
            _print({"error": err})
            return 1
    board = save_board(args.project, args.feature)
    if "error" in board:
        _print(board)
        return 1
    out_path = Path(args.project).resolve() / ".dsh" / "baton" / validate_change_id(args.feature) / "board.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(_render_html(board), encoding="utf-8")
    print(f"Board generated: {out_path}")
    print(f"  Open by double-clicking, or: file://{out_path}")
    print(f"  Tasks: {board['stats']['total']}  resolved: {board['stats'].get('resolved', 0)}")
    return 0


def cmd_build_all(args):
    board = save_board_all(args.project)
    for entry in board.get("skipped_changes", []):
        print(f"Skipped broken change {entry['feature']}: {entry['error']}", file=sys.stderr)
    if not board.get("tickets"):
        skipped = board.get("skipped_changes", [])
        if skipped:
            features = ", ".join(entry["feature"] for entry in skipped)
            print(
                f"No board generated: all {len(skipped)} change(s) failed to "
                f"parse ({features})",
                file=sys.stderr,
            )
        else:
            changes_dir = Path(args.project).resolve() / "openspec" / "changes"
            print(
                f"No OpenSpec changes with tasks.md found under {changes_dir}",
                file=sys.stderr,
            )
        return 1
    out_path = Path(args.project).resolve() / ".dsh" / "baton" / "board-all.html"
    out_path.write_text(_render_html(board), encoding="utf-8")
    print(f"Global board generated: {out_path}")
    print(f"  Open by double-clicking, or: file://{out_path}")
    print(f"  Changes: {len(board.get('features', []))}  Total tasks: {board['stats']['total']}  resolved: {board['stats'].get('resolved', 0)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="OpenSpec change board — static HTML boards + check helpers"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="scan a change's tasks.md → board.json")
    scan.add_argument("project")
    scan.add_argument(
        "feature",
        nargs="?",
        help="optional: inferred when the project has exactly one change",
    )
    scan.set_defaults(func=cmd_scan)

    check = sub.add_parser("check", help="flip a task to [x] (N.M id)")
    check.add_argument("project")
    check.add_argument("feature")
    check.add_argument("task", metavar="N.M")
    check.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and preview the flip; write nothing (no tasks.md, no board.json)",
    )
    check.set_defaults(func=cmd_check)

    uncheck = sub.add_parser("uncheck", help="flip a task back to [ ] (N.M id)")
    uncheck.add_argument("project")
    uncheck.add_argument("feature")
    uncheck.add_argument("task", metavar="N.M")
    uncheck.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and preview the flip; write nothing (no tasks.md, no board.json)",
    )
    uncheck.set_defaults(func=cmd_uncheck)

    build = sub.add_parser("build", help="generate a static HTML board (single change)")
    build.add_argument("project")
    build.add_argument(
        "feature",
        nargs="?",
        help="optional: inferred when the project has exactly one change",
    )
    build.set_defaults(func=cmd_build)

    build_all = sub.add_parser("build-all", help="generate the global multi-change board")
    build_all.add_argument("project")
    build_all.set_defaults(func=cmd_build_all)

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv[1:])
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
