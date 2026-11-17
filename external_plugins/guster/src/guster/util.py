from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Set, Tuple

try:
    import fcntl
except ImportError:  # pragma: no cover - non-POSIX hosts
    fcntl = None  # type: ignore[assignment]


EXCLUDE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "build",
    "dist",
    "out",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "target",
    ".idea",
    ".vscode",
}

TEXT_SUFFIXES = {
    ".md",
    ".markdown",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".sh",
    ".bash",
    ".zsh",
    ".py",
    ".js",
    ".mjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".go",
    ".java",
    ".kt",
    ".rs",
    ".rb",
    ".php",
    ".sql",
}

POINTER_SUFFIXES = {
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".bash",
    ".zsh",
    ".py",
    ".js",
    ".mjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".go",
    ".java",
    ".kt",
    ".rs",
    ".sql",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".mp4",
    ".mov",
    ".jsonl",
    ".csv",
}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def today_iso() -> str:
    return datetime.now().astimezone().date().isoformat()


def read_text(path: Path, limit: Optional[int] = None) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    if limit is not None and len(text) > limit:
        return text[:limit]
    return text


def write_text(path: Path, text: str) -> None:
    """Atomic replace: a concurrent reader sees the old or the new file, never a mix."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(tmp_name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp_name)
        raise


@contextmanager
def state_lock(state_dir: Path) -> Iterator[None]:
    """Exclusive lock over one state dir so concurrent CLI runs cannot interleave
    scan/policy writes. flock is POSIX-only; elsewhere the lock degrades to a no-op
    while write_text itself stays atomic."""
    state_dir.mkdir(parents=True, exist_ok=True)
    handle = (state_dir / ".lock").open("w")
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        handle.close()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: Path) -> str:
    try:
        return sha256_bytes(path.read_bytes())
    except OSError:
        return ""


def is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def relative(path: Path, base: Path) -> str:
    try:
        return str(path.resolve().relative_to(base.resolve()))
    except (OSError, ValueError):
        return str(path)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9._-]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value or "item"


def unique_suffix(length: int = 3) -> str:
    """Random hex tail; same-second plan ids and backups must not overwrite."""
    return os.urandom(length).hex()


def human_bytes(value: int) -> str:
    if value < 1024:
        return f"{value} B"
    if value < 1024 * 1024:
        return f"{value / 1024:.1f} KB"
    return f"{value / (1024 * 1024):.1f} MB"


def json_dumps(data: Any, pretty: bool = True) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2 if pretty else None, sort_keys=False)


def load_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def load_json_strict(path: Path) -> Tuple[Any, Optional[str]]:
    """Value and error apart: absent is (None, None), corrupt is (None, reason).

    Missing and corrupt are different conditions; a caller that can rescan must
    warn about corruption instead of silently treating it as absent."""
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None, None
    except OSError as exc:
        return None, str(exc)
    try:
        return json.loads(raw), None
    except ValueError as exc:
        return None, str(exc)


def is_indexed(name: str, index_text: str) -> bool:
    """A backtick-wrapped index row, bare or as a `dir/name` tail.

    A bare substring does not count: `a.md` inside `data.md` is not an index row."""
    return f"`{name}`" in index_text or f"/{name}`" in index_text


def save_json(path: Path, data: Any) -> None:
    write_text(path, json_dumps(data) + "\n")


def parse_frontmatter(text: str) -> Tuple[Dict[str, str], str]:
    """Parse the small YAML frontmatter subset used by agent files.

    Supports scalar keys, quoted values and literal/folded blocks. It deliberately
    avoids a PyYAML dependency so the plugin runs on a stock Python install.
    """
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    end: Optional[int] = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end = index
            break
    if end is None:
        return {}, text

    data: Dict[str, str] = {}
    index = 1
    while index < end:
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        if line.startswith((" ", "\t")) or ":" not in line:
            index += 1
            continue
        key, raw = line.split(":", 1)
        key = key.strip()
        value = raw.strip()
        if value in ("|", ">"):
            block: List[str] = []
            index += 1
            while index < end:
                candidate = lines[index]
                if candidate.startswith("  "):
                    block.append(candidate[2:])
                elif not candidate.strip():
                    block.append("")
                else:
                    break
                index += 1
            data[key] = ("\n" if value == "|" else " ").join(block).strip()
            continue
        data[key] = unquote(value)
        index += 1
    return data, "\n".join(lines[end + 1 :])


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    return value


def first_heading(text: str, fallback: str = "") -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def iter_files(
    root: Path,
    suffixes: Optional[Set[str]] = None,
    max_depth: Optional[int] = None,
    skip_dirs: Optional[Set[str]] = None,
    errors: Optional[List[str]] = None,
) -> Iterator[Path]:
    if not root.exists():
        return
    skip = EXCLUDE_DIRS if skip_dirs is None else skip_dirs
    root = root.resolve()

    def on_error(exc: OSError) -> None:
        if errors is not None:
            errors.append(f"{exc.filename or root}: {exc.strerror or exc}")

    for current, dirs, files in os.walk(root, onerror=on_error):
        current_path = Path(current)
        depth = len(current_path.relative_to(root).parts)
        if max_depth is not None and depth >= max_depth:
            dirs[:] = []
        dirs[:] = sorted(d for d in dirs if d not in skip)
        for name in sorted(files):
            path = current_path / name
            if suffixes is not None and path.suffix.lower() not in suffixes:
                continue
            yield path


def find_git_roots(roots: Sequence[Path], max_depth: int = 5) -> List[Path]:
    found: List[Path] = []
    seen: Set[str] = set()

    def visit(path: Path, depth: int) -> None:
        try:
            resolved = str(path.resolve())
        except OSError:
            return
        if resolved in seen:
            return
        seen.add(resolved)
        if not path.is_dir():
            return
        if (path / ".git").exists():
            found.append(path)
            return
        if depth >= max_depth:
            return
        try:
            entries = sorted(path.iterdir(), key=lambda item: item.name)
        except OSError:
            return
        for entry in entries:
            if entry.name in EXCLUDE_DIRS or entry.name.startswith("."):
                continue
            if entry.is_dir():
                visit(entry, depth + 1)

    for root in roots:
        visit(root, 0)
    return sorted(found, key=lambda item: str(item))


def git_tracked(root: Path) -> Optional[Set[str]]:
    """Tracked paths; None means git could not answer, never a silent empty set."""
    if not (root / ".git").exists():
        return set()
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    tracked: Set[str] = set()
    for raw in result.stdout.split(b"\x00"):
        if not raw:
            continue
        tracked.add(raw.decode("utf-8", errors="replace"))
    return tracked


def git_last_commit_dates(root: Path) -> Optional[Dict[str, str]]:
    """Map repo-relative paths to the newest commit date; None when git failed."""
    if not (root / ".git").exists():
        return {}
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%x00%cI", "--name-only"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        if result.returncode == 128 and "does not have any commits yet" in (
            result.stderr or ""
        ):
            # A freshly `git init`-ed repo has no history to read: no dates,
            # not a git failure.
            return {}
        return None
    dates: Dict[str, str] = {}
    current = ""
    for line in result.stdout.splitlines():
        if line.startswith("\x00"):
            current = line[1:].strip()
            continue
        rel = line.strip()
        if not rel or not current:
            continue
        dates.setdefault(rel, current)
    return dates


NOTE_DATE_KEYS = ("updated", "date", "lastmod", "created")
_NOTE_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ][\d:]+)?")


def parse_note_header(text: str) -> Optional[Dict[str, Any]]:
    """Parse a knowledge note's YAML front-matter (CTX-09).

    Follows the Obsidian properties convention — the interchange format the
    open-source markdown knowledge bases (Foam, Quartz, Logseq) all accept.
    Hand-rolled for the simple subset (scalar keys, one list per key, ``#``
    comments, literal/folded block scalars) because the CLI runs on stock
    Python without third-party deps.

    Returns None when the text has no front-matter or declares no ``type`` —
    the structured header is opt-in, and that gate wins over malformedness,
    so legacy prose notes that merely open with dashes never report. A dict
    with ``_malformed`` reports a header that opted in but cannot be parsed.
    """
    lines = text.splitlines()
    if not text.startswith("---") or not lines or lines[0].strip() != "---":
        return None
    keys: Dict[str, Any] = {}
    list_key: Optional[str] = None
    malformed: Optional[Dict[str, Any]] = None
    end: Optional[int] = None
    limit = min(len(lines), 80)
    index = 1
    while index < limit:
        line = lines[index]
        if line.strip() == "---":
            end = index
            break
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            index += 1
            continue
        if stripped.startswith("- ") and list_key is not None:
            value = stripped[2:].split("#", 1)[0].strip()
            if value:
                keys[list_key].append(value)
            index += 1
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", stripped)
        if not match:
            if malformed is None:
                malformed = {"line": index + 1, "text": stripped[:60]}
            index += 1
            continue
        key = match.group(1)
        value = match.group(2).split("#", 1)[0].strip()
        if value in ("|", ">"):
            block: List[str] = []
            index += 1
            while index < limit:
                candidate = lines[index]
                if candidate.startswith("  "):
                    block.append(candidate[2:])
                elif not candidate.strip():
                    block.append("")
                else:
                    break
                index += 1
            keys[key] = ("\n" if value == "|" else " ").join(block).strip()
            list_key = None
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            keys[key] = value
            list_key = None
        else:
            keys[key] = []
            list_key = key
        index += 1
    note_type = keys.get("type")
    if isinstance(note_type, list):
        note_type = note_type[0] if note_type else ""
    if not note_type or not str(note_type).strip().strip("[]"):
        return None
    if malformed is not None:
        return {"_malformed": True, **malformed}
    if end is None:
        return {"_malformed": True, "line": len(lines), "text": "front-matter not closed"}
    return keys


def note_header_date(header: Dict[str, Any]) -> Optional[str]:
    """First machine-readable date value among the convention's date keys."""
    for key in NOTE_DATE_KEYS:
        value = header.get(key)
        if isinstance(value, str) and _NOTE_DATE_RE.match(value.strip()):
            return value.strip()
    return None


def extract_pointers(text: str) -> List[str]:
    # A leading front-matter block is metadata, not prose (CTX-09: the body,
    # never the header, joins the pointer scan).
    text = _strip_frontmatter(text)
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    pointers: List[str] = []

    def add(candidate: str) -> None:
        # `[`path`](path)` matches both the link and the inline-code pass; count
        # each target once per file so pointer health is not double-weighted.
        if _looks_like_pointer(candidate) and candidate not in pointers:
            pointers.append(candidate)

    for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", text):
        add(match.group(1).strip())
    for match in re.finditer(r"`([^`\n]+)`", text):
        candidate = match.group(1).strip()
        if candidate.startswith("~/") and _is_remote_command(_line_at(text, match.start())):
            continue
        add(candidate)
    return pointers


def _line_at(text: str, offset: int) -> str:
    start = text.rfind("\n", 0, offset) + 1
    end = text.find("\n", offset)
    return text[start : end if end != -1 else len(text)]


def _is_remote_command(line: str) -> bool:
    # `ssh mini` + `~/...` in the same line names the remote home, not a local path.
    if re.search(r"\bssh\s+(?:-[\w-]+\s+)*[A-Za-z0-9._-]+", line):
        return True
    return re.search(r"\b(?:scp|rsync)\b[^\n]*?[A-Za-z0-9._-]+:~/", line) is not None


def _looks_like_pointer(candidate: str) -> bool:
    if not candidate or _is_placeholder(candidate):
        return False
    if any(char.isspace() for char in candidate):
        return False
    if candidate.startswith(("http://", "https://", "mailto:", "tel:", "#", "...")):
        return False
    suffix = Path(candidate).suffix.lower()
    if candidate.startswith("~/"):
        return True
    if candidate.startswith(("./", "../")):
        return True
    if candidate.startswith("/"):
        known_roots = (
            "/Users/",
            "/home/",
            "/tmp/",
            "/Applications/",
            "/System/",
            "/opt/",
            "/usr/",
            "/var/",
            "/etc/",
            "/private/",
            "/Volumes/",
        )
        return candidate.startswith(known_roots)
    if candidate.endswith("/"):
        # A relative directory pointer (`knowledge/general/`) has no suffix and
        # is still a link worth checking.
        return True
    return "/" in candidate and suffix in POINTER_SUFFIXES


def _is_placeholder(pointer: str) -> bool:
    if any(token in pointer for token in ("<", ">", "*", "{", "}", "$", "|")):
        return True
    # File templates in docs: draft-NNN.md, daily-YYYY-MM-DD.md, 0X-xxx.md.
    return re.search(r"(?:N{2,}|Y{4}|X{3,}|x{3,}|0[xX][-_/])", pointer) is not None


def _strip_pointer(pointer: str) -> str:
    pointer = pointer.strip()
    if pointer.startswith("<") and ">" in pointer:
        pointer = pointer[1 : pointer.index(">")]
    pointer = pointer.split(" ", 1)[0]
    if pointer.startswith("file://"):
        pointer = pointer[7:]
    pointer = re.sub(r":\d+(?::\d+)?$", "", pointer)
    return pointer


# Path-shaped token in prose: optional ~/ ./ ../ / prefix, then at least one
# path segment. The lookbehind keeps the match from starting inside a word, a
# URL or an email; CJK characters do not block, so `见docs/x.md` still matches.
NAKED_POINTER_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_.:/`~@-])(?:~/|\.{1,2}/|/)?(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+"
)


def _strip_frontmatter(text: str) -> str:
    """Body after a leading YAML front-matter block; header metadata is not prose."""
    if not text.startswith("---"):
        return text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return text
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "\n".join(lines[index + 1 :])
    return text


def extract_naked_pointers(text: str) -> List[str]:
    """File-shaped paths left in prose after links, code spans and code blocks are removed.

    Only suffix-bearing paths count: directory references in prose (a bare
    `~/some/repo`) name a place far more often than they point at a read, and
    flagging them would drown the signal. A leading front-matter block is
    metadata, not prose — a path-valued key (CTX-09 `superseded_by`) is never
    a naked pointer.
    """
    text = _strip_frontmatter(text)
    residual = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    residual = re.sub(r"\[[^\]]*\]\([^)]+\)", "", residual)
    residual = re.sub(r"`[^`\n]+`", "", residual)
    found: List[str] = []
    for match in NAKED_POINTER_TOKEN_RE.finditer(residual):
        token = match.group(0).rstrip(".,;:!?\"')")
        if not token or token in found:
            continue
        if _is_placeholder(token):
            continue
        if token.startswith(("http://", "https://", "mailto:", "tel:", "#")):
            continue
        if token.startswith(("/tmp/", "/private/tmp/", "/var/folders/")):
            continue
        if Path(token).suffix.lower() not in POINTER_SUFFIXES:
            continue
        found.append(token)
    return found


def find_repo_root(start: Path) -> Optional[Path]:
    """Nearest enclosing git work tree; `.claude/` and `.agents/` docs address the repo root."""
    cursor = start
    for _ in range(8):
        if (cursor / ".git").exists():
            return cursor
        if cursor.parent == cursor:
            return None
        cursor = cursor.parent
    return None


def resolve_pointer(
    pointer: str,
    base_file: Path,
    hub: Optional[Path] = None,
    home: Optional[Path] = None,
    config_roots: Optional[Sequence[Path]] = None,
) -> Optional[Path]:
    if not pointer or _is_placeholder(pointer):
        return None
    cleaned = _strip_pointer(pointer)
    lowered = cleaned.lower()
    if lowered.startswith(("http://", "https://", "mailto:", "tel:", "#")):
        return None
    if not cleaned:
        return None
    expanded = Path(os.path.expanduser(cleaned))
    if expanded.is_absolute():
        if str(expanded).startswith(("/tmp/", "/private/tmp/", "/var/folders/")):
            # Runtime scratch paths are never expected to exist at rest.
            return None
        return expanded
    if cleaned.startswith(("./", "../")):
        return (base_file.parent / expanded).resolve()
    anchor = cleaned.split("/", 1)[0]
    anchors: List[Path] = [base_file.parent]
    repo_root = find_repo_root(base_file.parent)
    if repo_root is not None and repo_root != base_file.parent:
        anchors.append(repo_root)
    if hub is not None:
        anchors.append(hub)
    if home is not None:
        anchors.append(home)
    if config_roots:
        # Anchors follow the user's declared roots, never hardcoded layouts.
        anchors.extend(config_roots)
    if not any((root / anchor).exists() for root in anchors):
        # A bare relative path only counts as a pointer when its first segment
        # exists in one of the known roots. Otherwise it is prose about another repo.
        return None
    candidates: List[Path] = [(root / expanded).resolve() for root in anchors]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def age_days(path: Path) -> Optional[float]:
    """Age in days; None when stat fails — unknown age, never a fake zero."""
    try:
        return max(0.0, (time.time() - path.stat().st_mtime) / 86400.0)
    except OSError:
        return None


def parse_date(value: str) -> Optional[datetime]:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None
