"""OpenSpec tasks.md parsing — the ticket source of baton.

The plan face is an OpenSpec change: ``openspec/changes/<change-id>/`` with
``proposal.md`` (why/what) and ``tasks.md`` (the task checklist). baton maps:

    change  →  feature   (``openspec/changes/<change-id>``)
    task    →  ticket    (``- [ ] 1.2 description`` in tasks.md)

Mapping rules (authoritative source: docs/ticket-format.md):

- ``## N. Section title`` starts section N.
- ``- [ ] N.M text`` / ``- [x] N.M text`` is task N.M (bullet ``-``/``*``/``+``,
  checkbox ``[ ]``/``[x]``/``[X]`` all tolerated).
- A checkbox with a task id but no text (``- [ ] 1.2``) is a validation error
  naming the line — never a silently dropped ticket.
- Lines inside a fenced code block (````` ``` `````) are not tasks; example
  checkboxes in docs stay examples.
- Ticket num = ``N * 100 + M`` (1.2 → 102, 3.4 → 304); reversible for display.
- Status: unchecked → ``ready``; checked → ``resolved``. No draft state —
  an unapproved change simply is not run.
- DAG: section-ordered. Task N.M is blocked by every task in sections that
  appear before it in the file; tasks within one section are independent
  (parallel frontier). Sections are phases in real-world tasks.md files, so
  file order is the safe dependency order.
- ``check_task`` flips ``[ ]`` → ``[x]`` for one task (the resolved
  write-back); there is no in-progress projection — the durable store owns
  live attempt state.
"""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

VALID_STATUSES = {"ready", "resolved"}

_SECTION_RE = re.compile(r"^##\s+(\d+)\s*[.\u3002]?\s*(.*?)\s*$")
_TASK_RE = re.compile(r"^[-*+]\s*\[\s*([ xX])\s*\]\s+(\d+)\.(\d+)\s+(.+?)\s*$")
_TASK_NO_TEXT_RE = re.compile(r"^[-*+]\s*\[\s*[ xX]\s*\]\s+\d+\.\d+\s*$")
_FENCE_RE = re.compile(r"^\s*```")
_CHANGE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def validate_change_id(change_id: str) -> str:
    """Return ``change_id`` when it is one safe path segment.

    A change id names both ``openspec/changes/<id>/`` and the runtime
    directory ``.dsh/baton/<id>/``. Anything that can traverse out of those
    roots (empty, ``.``, ``..``, separators) is rejected instead of being
    silently rewritten.
    """
    if not isinstance(change_id, str) or not change_id:
        raise ValueError("change id must be a non-empty string")
    if change_id in {".", ".."} or "/" in change_id or "\\" in change_id:
        raise ValueError(f"change id must be one path segment, got {change_id!r}")
    if not _CHANGE_ID_RE.match(change_id) or change_id.endswith("."):
        raise ValueError(
            "change id must match [A-Za-z0-9][A-Za-z0-9._-]* and not end with '.', "
            f"got {change_id!r}"
        )
    return change_id


@dataclass
class Ticket:
    """One OpenSpec task, parsed from tasks.md.

    Attributes:
        num: ticket number (N*100+M from task id N.M; authoritative source).
        title: the task text (with the N.M id stripped).
        what_to_build: same as title — the task text is the deliverable.
        blocked_by: nums of all tasks in earlier sections.
        status: ready (unchecked) / resolved (checked).
        criteria: single criterion — the task text itself.
        file_path: path to tasks.md (used for write-back).
        section: title of the section the task lives in.
    """

    num: int
    title: str
    what_to_build: str = ""
    blocked_by: list[int] = field(default_factory=list)
    status: str = "ready"
    criteria: list[tuple[bool, str]] = field(default_factory=list)
    file_path: str = ""
    section: str = ""

    @property
    def task_id(self) -> str:
        """Display id ``N.M`` reconstructed from num."""
        return f"{self.num // 100}.{self.num % 100}"


def task_num(section: int, item: int) -> int:
    """Composite ticket number for task ``section.item``."""
    if not 1 <= section <= 99 or not 1 <= item <= 99:
        raise ValueError(f"task id {section}.{item} out of supported range")
    return section * 100 + item


class TasksMarkdownError(ValueError):
    """tasks.md is missing or malformed."""


def parse_tasks_md(path: str | Path) -> list[Ticket]:
    """Parse an OpenSpec ``tasks.md`` into tickets, ordered by num.

    Raises:
        TasksMarkdownError: file missing, no sections/tasks, duplicate or
            misfiled task ids, a task id with no description text.
    """
    path = Path(path)
    if not path.is_file():
        raise TasksMarkdownError(
            f"OpenSpec tasks.md not found: {path} — a change needs "
            f"openspec/changes/<id>/proposal.md + tasks.md before baton can run it"
        )
    text = path.read_text(encoding="utf-8")

    section_titles: dict[int, str] = {}  # section no → title (file order kept below)
    section_order: list[int] = []
    parsed: list[tuple[int, int, bool, str]] = []  # (section, item, done, text)
    seen_nums: set[int] = set()
    current_section: int | None = None
    in_fence = False

    for lineno, raw in enumerate(text.splitlines(), start=1):
        if _FENCE_RE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        section_match = _SECTION_RE.match(raw)
        if section_match:
            current_section = int(section_match.group(1))
            if current_section not in section_titles:
                section_order.append(current_section)
                section_titles[current_section] = section_match.group(2)
            continue
        if current_section is None:
            continue
        if _TASK_NO_TEXT_RE.match(raw):
            raise TasksMarkdownError(
                f"task on line {lineno} of {path} has no description text: "
                f"{raw.strip()!r}"
            )
        task_match = _TASK_RE.match(raw)
        if task_match:
            done = task_match.group(1).lower() == "x"
            sec, item = int(task_match.group(2)), int(task_match.group(3))
            if sec != current_section:
                raise TasksMarkdownError(
                    f"task {sec}.{item} is listed under section {current_section} in {path}"
                )
            try:
                num = task_num(sec, item)
            except ValueError as exc:
                raise TasksMarkdownError(f"{path}: {exc}") from exc
            if num in seen_nums:
                raise TasksMarkdownError(f"duplicate task id {sec}.{item} in {path}")
            seen_nums.add(num)
            parsed.append((sec, item, done, task_match.group(4)))

    if not section_order:
        raise TasksMarkdownError(f"no `## N.` sections found in {path}")
    if not parsed:
        raise TasksMarkdownError(f"no `- [ ] N.M` tasks found in {path}")

    # Section-order DAG in file order: each section is blocked by the union of
    # all tasks in previously appearing sections.
    blocked_by_section: dict[int, list[int]] = {}
    earlier: set[int] = set()
    for sec in section_order:
        blocked_by_section[sec] = sorted(earlier)
        earlier |= {task_num(p[0], p[1]) for p in parsed if p[0] == sec}

    tickets = [
        Ticket(
            num=task_num(sec, item),
            title=text,
            what_to_build=text,
            blocked_by=list(blocked_by_section[sec]),
            status="resolved" if done else "ready",
            criteria=[(done, text)],
            file_path=str(path),
            section=section_titles[sec],
        )
        for sec, item, done, text in parsed
    ]
    tickets.sort(key=lambda t: t.num)
    return tickets


def check_task(path: str | Path, num: int) -> None:
    """Flip task ``num`` to checked ``[x]`` in tasks.md (idempotent, atomic).

    The checked-off line keeps every other byte of the file — the checkbox
    tolerance mirrors ``parse_tasks_md`` (bullet ``-``/``*``/``+``, any
    whitespace inside ``[ ]``) and the file's line endings are preserved, so
    a CRLF checkout does not turn one flip into a whole-file diff.

    Raises:
        TasksMarkdownError: file missing or the task id is not present.
    """
    path = Path(path)
    if not path.is_file():
        raise TasksMarkdownError(f"OpenSpec tasks.md not found: {path}")
    task_id = f"{num // 100}.{num % 100}"
    with open(path, encoding="utf-8", newline="") as handle:
        text = handle.read()
    pattern = re.compile(
        r"^([-*+][ \t]*\[)[ \t]+(\][ \t]+" + re.escape(task_id) + r"(?:\s|$))",
        re.MULTILINE,
    )
    new_text, count = pattern.subn(r"\g<1>x\g<2>", text)
    if count == 0:
        if re.search(
            r"^[-*+][ \t]*\[[ \t]*[xX][ \t]*\][ \t]+" + re.escape(task_id) + r"(?:\s|$)",
            text,
            re.MULTILINE,
        ):
            return  # already checked — idempotent
        raise TasksMarkdownError(f"task {task_id} not found in {path}")
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as handle:
        handle.write(new_text)
    tmp.replace(path)


def uncheck_task(path: str | Path, num: int) -> None:
    """Flip task ``num`` back to unchecked ``[ ]`` in tasks.md (the reverse).

    The exact mirror of :func:`check_task`: same checkbox tolerance
    (``[x]``/``[X]``/``[ x ]``), same byte-preserving atomic ``tmp`` + rename
    write and the same ``newline=""`` read so a CRLF checkout keeps its line
    endings. ``ticket_board uncheck`` is the documented ``reverse`` of baton's
    own ``[x]`` write-back, so it must not turn one flip into a whole-file diff.

    Raises:
        TasksMarkdownError: file missing or the task is not currently checked.
    """
    path = Path(path)
    if not path.is_file():
        raise TasksMarkdownError(f"OpenSpec tasks.md not found: {path}")
    task_id = f"{num // 100}.{num % 100}"
    with open(path, encoding="utf-8", newline="") as handle:
        text = handle.read()
    pattern = re.compile(
        r"^([-*+][ \t]*\[)[ \t]*[xX][ \t]*(\][ \t]+"
        + re.escape(task_id)
        + r"(?:\s|$))",
        re.MULTILINE,
    )
    new_text, count = pattern.subn(r"\g<1> \g<2>", text)
    if count == 0:
        raise TasksMarkdownError(f"task {task_id} is not checked in {path}")
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as handle:
        handle.write(new_text)
    tmp.replace(path)


__all__ = [
    "TasksMarkdownError",
    "Ticket",
    "VALID_STATUSES",
    "check_task",
    "parse_tasks_md",
    "task_num",
    "uncheck_task",
]
