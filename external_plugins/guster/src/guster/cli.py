from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from . import __version__
from .discover import ScanConfig, count_zone_tools, default_roots, scan
from .executor import ApplyError, apply_plan, init_home
from .hub import attach_hub, default_hub_path, init_hub, validate_hub
from .metrics import compute_metrics, metric_line
from .planner import (
    load_plan,
    plan_from_findings,
    plan_init_project,
    plan_move,
    save_plan,
)
from .policy import run_policy
from .report import redacted_registry, render_report, render_status
from .util import (
    json_dumps,
    load_json_strict,
    now_iso,
    save_json,
    state_lock,
    write_text,
)


def default_state_dir(home: Path) -> Path:
    return home / ".agents" / "guster"


def state_dir_from(args: argparse.Namespace) -> Path:
    """Explicit --state-dir or the machine default; used by commands that do
    not need a full scan config (init/apply/plan/hub/zones)."""
    if args.state_dir:
        return Path(args.state_dir).expanduser()
    return default_state_dir(Path.home())


def load_config(config_path: Path) -> Dict[str, Any]:
    if not config_path.is_file():
        return {}
    try:
        local = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"cannot read Guster config {config_path}: {exc}") from exc
    if not isinstance(local, dict):
        raise ValueError(f"Guster config must be a JSON object: {config_path}")
    return local


def resolve_root(root: Path) -> Path:
    if not root.exists():
        raise ValueError(f"workspace root does not exist: {root.resolve()}")
    if not root.is_dir():
        raise ValueError(f"workspace root is not a directory: {root.resolve()}")
    return root


def parse_roots(raw: Any, config_path: Path) -> List[Path]:
    """Config roots must be existing absolute directories; one bad entry stops
    the run instead of being silently reinterpreted (a bare string is a type
    error, never a list of characters)."""
    if not isinstance(raw, list):
        raise ValueError(
            f"Guster config 'roots' must be a list of absolute paths, "
            f"got {type(raw).__name__}: {config_path}"
        )
    if not raw:
        raise ValueError(f"Guster config 'roots' must list at least one path: {config_path}")
    roots: List[Path] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(
                f"Guster config 'roots' entries must be non-empty strings: {item!r} in {config_path}"
            )
        path = Path(item).expanduser()
        if not path.is_absolute():
            raise ValueError(
                f"Guster config 'roots' entries must be absolute paths: {item!r} in {config_path}"
            )
        roots.append(resolve_root(path))
    return roots


def parse_zones(raw: Any, config_path: Path) -> List[Dict[str, str]]:
    if not isinstance(raw, list):
        raise ValueError(f"Guster config 'zones' must be a list: {config_path}")
    zones: List[Dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict) or not str(item.get("path", "")).strip():
            raise ValueError(f"zone entry needs a 'path' in {config_path}: {item!r}")
        zone_path = Path(str(item["path"])).expanduser()
        if not zone_path.is_absolute():
            raise ValueError(
                f"Guster config 'zones' entries must be absolute paths: {item!r} in {config_path}"
            )
        profile = str(item.get("profile", "light"))
        if not zone_path.is_dir():
            raise ValueError(f"configured zone does not exist: {zone_path.resolve()}")
        if profile not in {"light", "full"}:
            raise ValueError(f"zone profile must be 'light' or 'full': {profile}")
        zones.append({"path": str(zone_path), "profile": profile})
    return zones


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", action="append", default=None, help="Workspace root; repeatable.")
    parser.add_argument(
        "--scope",
        choices=["auto", "machine", "hub", "project", "group"],
        default="auto",
        help="Context scope: machine (default), hub, one project, or a group of projects.",
    )
    parser.add_argument("--hub", default=None, help="Guster Hub path.")
    parser.add_argument("--state-dir", default=None, help="Guster state directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON.")
    parser.add_argument("--quiet", action="store_true", help="Only print errors.")


def cli_roots(raw: Optional[Sequence[str]]) -> List[Path]:
    """--root values follow the config roots discipline: existing absolute dirs,
    so the persisted registry never carries a path that drifts with CWD."""
    roots: List[Path] = []
    for item in raw or []:
        path = Path(item).expanduser()
        if not path.is_absolute():
            raise ValueError(f"--root paths must be absolute: {item!r}")
        roots.append(resolve_root(path))
    return roots


def parse_max_depth(raw: Any, config_path: Path) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        raise ValueError(
            f"Guster config 'scan_max_depth' must be a positive integer, "
            f"got {raw!r} ({type(raw).__name__}) in {config_path}"
        )
    return raw


def build_config(args: argparse.Namespace) -> ScanConfig:
    home = Path.home()
    base_state = Path(args.state_dir).expanduser() if args.state_dir else default_state_dir(home)
    config_path = base_state / "config.json"
    unconfigured = not config_path.is_file()
    local = load_config(config_path)

    hub: Optional[Path] = None
    if args.hub:
        hub = Path(args.hub).expanduser()
    elif "hub" in local:
        raw_hub = local["hub"]
        if not isinstance(raw_hub, str) or not raw_hub.strip():
            raise ValueError(f"Guster config 'hub' must be a path string: {config_path}")
        hub = Path(raw_hub).expanduser()
    if hub is not None:
        if not hub.exists():
            raise ValueError(f"hub directory does not exist: {hub.resolve()}")
        if not hub.is_dir():
            raise ValueError(f"hub is not a directory: {hub.resolve()}")

    explicit_roots = cli_roots(args.root)
    scope = getattr(args, "scope", "auto") or "auto"
    if scope == "auto":
        scope = "machine" if not explicit_roots else ("project" if len(explicit_roots) == 1 else "group")
    if scope in {"project", "group"} and not explicit_roots:
        raise ValueError("--scope project|group needs at least one --root")
    if scope == "hub" and hub is None:
        raise ValueError("--scope hub needs --hub or an attached hub")
    auto_roots = False
    if scope == "hub":
        roots: List[Path] = []
    elif explicit_roots:
        roots = explicit_roots
    elif "roots" in local:
        roots = parse_roots(local.get("roots"), config_path)
    else:
        roots = default_roots(home)
        if not roots:
            raise ValueError(
                "no workspace roots configured and none of "
                "~/Projects, ~/code, ~/dev, ~/src exists — "
                "run `guster init --root <path>` to configure Guster"
            )
        auto_roots = True

    state_dir = base_state
    if not args.state_dir and (scope != "machine" or explicit_roots):
        # Scoped runs keep their own registry and trend so they never overwrite
        # the machine-wide view.
        key = "|".join([scope] + sorted(str(root.resolve()) for root in roots) + [str(hub or "")])
        state_dir = base_state / "scoped" / hashlib.sha1(key.encode()).hexdigest()[:10]

    plugin_root = Path(__file__).resolve().parents[2]
    zones = parse_zones(local.get("zones", []), config_path)

    return ScanConfig(
        home=home,
        hub=hub,
        roots=roots,
        state_dir=state_dir,
        plugin_root=plugin_root,
        max_depth=parse_max_depth(local.get("scan_max_depth", 5), config_path),
        scope=scope,
        zones=zones,
        unconfigured=unconfigured,
        auto_roots=auto_roots,
    )


def ensure_state(config: ScanConfig) -> None:
    config.state_dir.mkdir(parents=True, exist_ok=True)
    (config.state_dir / "plans").mkdir(parents=True, exist_ok=True)
    (config.state_dir / "backups").mkdir(parents=True, exist_ok=True)


def do_scan(config: ScanConfig, write: bool = True) -> Dict[str, Any]:
    ensure_state(config)
    with state_lock(config.state_dir):
        registry = scan(config)
        if write:
            save_json(config.state_dir / "registry.json", registry)
    return registry


def load_registry(config: ScanConfig) -> Optional[Dict[str, Any]]:
    """Cached registry; corrupt content warns and reads as absent so `status`
    rescans instead of silently self-healing."""
    path = config.state_dir / "registry.json"
    data, error = load_json_strict(path)
    if error is not None:
        print(f"[guster] warning: {path} is corrupt ({error}); rescanning", file=sys.stderr)
        return None
    if data is None:
        return None
    if not isinstance(data, dict):
        print(f"[guster] warning: {path} is not a JSON object; rescanning", file=sys.stderr)
        return None
    return data


def evaluate(registry: Dict[str, Any], config: ScanConfig) -> Dict[str, Any]:
    policy_result = run_policy(registry, config)
    metric_result = compute_metrics(registry, policy_result)
    return {"policy": policy_result, "metrics": metric_result}


def append_metric(config: ScanConfig, metric_result: Dict[str, Any]) -> None:
    ensure_state(config)
    with state_lock(config.state_dir):
        path = config.state_dir / "metrics.jsonl"
        line = {
            "at": metric_result.get("generated_at", now_iso()),
            "scope": metric_result.get("scope"),
            "chi": metric_result.get("chi"),
            "dims": metric_result.get("dims"),
            "unscored_dims": metric_result.get("unscored_dims"),
            "metrics": metric_result.get("metrics", {}),
            "scores": metric_result.get("scores", {}),
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")


def last_metric(config: ScanConfig) -> Optional[Dict[str, Any]]:
    """Newest persisted snapshot; `status` reports this instead of mixing a stale scan with fresh policy."""
    path = config.state_dir / "metrics.jsonl"
    if not path.is_file():
        return None
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        return None
    try:
        item = json.loads(lines[-1])
    except ValueError as exc:
        print(f"[guster] warning: {path} last line is corrupt ({exc}); no cached metric shown", file=sys.stderr)
        return None
    if not isinstance(item, dict):
        print(f"[guster] warning: {path} last line is not a JSON object; no cached metric shown", file=sys.stderr)
        return None
    item.setdefault("generated_at", item.get("at"))
    return item


def write_findings(config: ScanConfig, policy_result: Dict[str, Any]) -> None:
    ensure_state(config)
    with state_lock(config.state_dir):
        save_json(config.state_dir / "findings.json", policy_result)


def print_scan_summary(registry: Dict[str, Any], config: ScanConfig) -> None:
    summary = registry.get("summary", {})
    print("Guster scan")
    print(f"  workspaces: {', '.join(registry.get('workspaces', []))}")
    print(f"  hub:        {registry.get('hub') or '(none)'}")
    if config.scope == "hub":
        print(
            f"  projects:   {summary.get('project_cards', 0)} "
            f"(scanned roots: {summary.get('projects', 0)})"
        )
    else:
        print(f"  projects:   {summary.get('projects', 0)}")
    print(f"  .agents:    {summary.get('agents_dirs', 0)} (indexed {summary.get('agents_with_index', 0)})")
    print(f"  skills:     {summary.get('skills', 0)} unique / {summary.get('skill_copies', 0)} copies")
    print(f"  knowledge:  {summary.get('knowledge', 0)}")
    print(f"  state:      {summary.get('state', 0)}")
    print(f"  evidence:   {summary.get('evidence', 0)}")
    print(f"  credentials:{summary.get('secret_files', 0)} files; {summary.get('inline_bearers', 0)} inline")
    print(f"  registry:   {config.state_dir / 'registry.json'}")


def cmd_status(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = load_registry(config)
    cached = registry is not None
    if registry is None:
        registry = do_scan(config, write=True)
    policy_result: Optional[Dict[str, Any]] = None
    if cached:
        # The cached registry describes an earlier scan. Running policy against
        # it would mix old artifacts with fresh file contents, so report the
        # stored snapshot and let `doctor` own the fresh evaluation.
        metric_result = last_metric(config)
    else:
        result = evaluate(registry, config)
        policy_result = result["policy"]
        metric_result = result["metrics"]
    if args.json:
        print(json_dumps({
            "registry": {
                "plugin": registry.get("plugin"),
                "generated_at": registry.get("generated_at"),
                "hub": registry.get("hub"),
                "workspaces": registry.get("workspaces"),
                "summary": registry.get("summary"),
            },
            "metrics": metric_result,
            "cached": cached,
            "findings": None if policy_result is None else len(policy_result["findings"]),
            "scope": registry.get("scope"),
            "state_dir": str(config.state_dir),
        }))
    else:
        print(render_status(registry, metric_result))
        if policy_result is None:
            print("cached registry; run `guster doctor` for a fresh evaluation")
        elif metric_result is not None:
            print(metric_line(metric_result))
            print(f"findings: {len(policy_result['findings'])}")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=not args.no_write)
    if args.json:
        print(json_dumps(registry))
    elif not args.quiet:
        print_scan_summary(registry, config)
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=not args.no_write)
    result = evaluate(registry, config)
    policy_result = result["policy"]
    if not args.no_write:
        write_findings(config, policy_result)
    findings = policy_result["findings"]
    if args.json:
        print(json_dumps(policy_result))
    elif not args.quiet:
        print(render_report(registry, policy_result, result["metrics"]))
    severities = {item["severity"] for item in findings}
    if "critical" in severities:
        return 3
    if "high" in severities:
        return 2
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=not args.no_write)
    result = evaluate(registry, config)
    metric_result = result["metrics"]
    if not args.no_write:
        append_metric(config, metric_result)
    if args.json:
        print(json_dumps(metric_result))
    elif not args.quiet:
        chi = metric_result.get("chi")
        print(f"Guster Context Health: {'n/a' if chi is None else chi} / 100")
        print("")
        dims = set(metric_result.get("dims") or [])
        for key, value in metric_result["scores"].items():
            if dims and key not in dims:
                continue
            print(f"  {key.upper():4s} {'n/a' if value is None else f'{value:6.1f}'}")
        print("")
        print(metric_line(metric_result))
        print(f"registry: {config.state_dir / 'registry.json'}")
        print(f"metrics:  {config.state_dir / 'metrics.jsonl'}")
    if args.trend:
        path = config.state_dir / "metrics.jsonl"
        if path.is_file():
            lines = path.read_text(encoding="utf-8").splitlines()[-10:]
            print("")
            print("Recent trend:")
            for line in lines:
                try:
                    item = json.loads(line)
                    print(f"  {item.get('at')}  CHI {item.get('chi')}")
                except ValueError:
                    continue
    if args.fail_under is not None:
        chi = metric_result.get("chi")
        if chi is None:
            print("error: CHI is not computable; no dimension has evidence", file=sys.stderr)
            return 2
        if chi < args.fail_under:
            print(f"error: CHI {chi} is below --fail-under {args.fail_under}", file=sys.stderr)
            return 2
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """scan -> doctor -> score --trend in one pass; the exit code carries the
    doctor semantics (3 critical, 2 high, 0 clean)."""
    config = build_config(args)
    registry = do_scan(config, write=not args.no_write)
    result = evaluate(registry, config)
    policy_result = result["policy"]
    if not args.no_write:
        write_findings(config, policy_result)
        append_metric(config, result["metrics"])
    if args.json:
        print(json_dumps({"policy": policy_result, "metrics": result["metrics"]}))
    elif not args.quiet:
        print(render_report(registry, policy_result, result["metrics"]))
        path = config.state_dir / "metrics.jsonl"
        if path.is_file():
            lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()][-10:]
            if lines:
                print("")
                print("Recent trend:")
                for line in lines:
                    try:
                        item = json.loads(line)
                        print(f"  {item.get('at')}  CHI {item.get('chi')}")
                    except ValueError:
                        continue
    severities = {item["severity"] for item in policy_result["findings"]}
    if "critical" in severities:
        return 3
    if "high" in severities:
        return 2
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    if args.plan_action == "findings":
        config = build_config(args)
        ensure_state(config)
        registry = do_scan(config, write=True)
        result = evaluate(registry, config)
        plan = plan_from_findings(result["policy"]["findings"])
        state_dir = config.state_dir
    elif args.plan_action == "move":
        src = Path(args.source).expanduser()
        dst = Path(args.destination).expanduser()
        plan = plan_move(src, dst)
        state_dir = state_dir_from(args)
    elif args.plan_action == "init":
        plan = plan_init_project(Path(args.project).expanduser())
        state_dir = state_dir_from(args)
    else:
        raise SystemExit(f"unknown plan action: {args.plan_action}")

    path = save_plan(state_dir, plan)
    if args.json:
        print(json_dumps(plan))
    elif not args.quiet:
        print(f"plan: {path}")
        print(f"operations: {len(plan.get('operations', []))}")
        for index, operation in enumerate(plan.get("operations", []), start=1):
            kind = operation.get("kind")
            if kind == "move":
                print(f"  {index}. move {operation['src']} -> {operation['dst']}")
            elif kind == "mkdir":
                print(f"  {index}. mkdir {operation['path']}")
            elif kind == "write":
                print(f"  {index}. write {operation['path']}")
            elif kind == "manual":
                print(f"  {index}. manual {operation['path']}: {operation['action']}")
        print("review the plan; apply with `guster apply <plan> --yes`.")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    if args.dry_run and args.yes:
        raise ValueError("--dry-run and --yes are mutually exclusive")
    plan = load_plan(Path(args.plan).expanduser())
    result = apply_plan(
        plan,
        state_dir_from(args),
        dry_run=not args.yes,
        yes=args.yes,
    )
    if args.json:
        print(json_dumps(result))
    elif not args.quiet:
        if result.get("dry_run"):
            mode = "DRY RUN"
        elif result.get("ok"):
            mode = "APPLIED"
        else:
            mode = "FAILED"
        print(f"{mode}: {result.get('plan')}")
        print(f"  applied: {result.get('applied', 0)}")
        print(f"  skipped: {result.get('skipped', 0)}")
        if result.get("backup"):
            print(f"  backup:  {result['backup']}")
        if result.get("errors"):
            for error in result["errors"]:
                print(f"  error: {error}")
    return 0 if result.get("ok") else 4


def cmd_init(args: argparse.Namespace) -> int:
    state_dir = state_dir_from(args)
    if args.project:
        project = Path(args.project).expanduser()
        plan = plan_init_project(project)
        path = save_plan(state_dir, plan)
        result = apply_plan(plan, state_dir, dry_run=not args.yes, yes=args.yes)
        if not args.json and not args.quiet:
            print(f"plan: {path}")
            if result.get("dry_run"):
                missing: List[Path] = []
                probe = project.resolve()
                while not probe.exists() and probe != probe.parent:
                    missing.append(probe)
                    probe = probe.parent
                if missing:
                    print("  these directories do not exist yet and will be created:")
                    for entry in sorted(missing, key=lambda item: len(item.parts)):
                        print(f"    {entry}")
                for index, operation in enumerate(plan.get("operations", []), start=1):
                    kind = operation.get("kind")
                    if kind == "mkdir":
                        print(f"  {index}. mkdir {operation['path']}")
                    elif kind == "write":
                        print(f"  {index}. write {operation['path']}")
    else:
        explicit_roots = cli_roots(args.root)
        result = init_home(
            state_dir,
            yes=args.yes,
            dry_run=not args.yes,
            home=Path.home(),
            roots=explicit_roots or None,
        )
    if args.json:
        print(json_dumps(result))
    elif not args.quiet:
        if result.get("dry_run"):
            mode = "DRY RUN"
        elif result.get("ok"):
            mode = "APPLIED"
        else:
            mode = "FAILED"
        print(f"{mode}: init")
        print(f"  applied: {result.get('applied', 0)}")
        print(f"  skipped: {result.get('skipped', 0)}")
        if result.get("errors"):
            for error in result["errors"]:
                print(f"  error: {error}")
    return 0 if result.get("ok") else 4


def cmd_hub(args: argparse.Namespace) -> int:
    state_dir = state_dir_from(args)
    action = args.hub_action
    local = load_config(state_dir / "config.json")
    attached: Optional[Path] = None
    if "hub" in local:
        raw_hub = local["hub"]
        if not isinstance(raw_hub, str) or not raw_hub.strip():
            raise ValueError(
                f"Guster config 'hub' must be a path string: {state_dir / 'config.json'}"
            )
        attached = Path(raw_hub).expanduser()
    if attached is None and not getattr(args, "path", None) and not getattr(args, "hub", None):
        if action == "status":
            if args.json:
                print(json_dumps({"attached": False, "hub": None}))
            elif not args.quiet:
                print("no hub attached")
            return 0
        if action == "validate":
            raise ValueError("no hub attached; pass --path <hub> to validate one")
    target = Path(
        getattr(args, "path", None)
        or getattr(args, "hub", None)
        or attached
        or default_hub_path(Path.home())
    ).expanduser()

    if action == "init":
        result = init_hub(
            target,
            state_dir,
            yes=args.yes,
            dry_run=not args.yes,
            name=args.name,
            knowledge=args.knowledge,
            projects=args.projects,
            tools=args.tools,
        )
        if args.json:
            print(json_dumps(result))
        elif not args.quiet:
            if result.get("dry_run"):
                mode = "DRY RUN"
            elif result.get("ok"):
                mode = "APPLIED"
            else:
                mode = "FAILED"
            print(f"{mode}: hub {result['hub']}")
            print(f"  plan:     {result.get('plan')}")
            print(f"  applied:  {result.get('applied', 0)}")
            print(f"  skipped:  {result.get('skipped', 0)}")
            if result.get("attach"):
                print(f"  config:   {result['attach']['config']}")
            paths = result.get("paths") or {}
            if paths:
                print(
                    "  paths:    "
                    f"knowledge={paths['knowledge']} "
                    f"projects={paths['projects']} "
                    f"tools={paths['tools']}"
                )
            if result.get("errors"):
                for error in result["errors"]:
                    print(f"  error: {error}")
        return 0 if result.get("ok") else 4

    if action == "attach":
        result = attach_hub(state_dir, target)
        if args.json:
            print(json_dumps(result))
        elif not args.quiet:
            print(f"attached: {result['hub']}")
            print(f"  config: {result['config']}")
            if result.get("backup"):
                print(f"  backup: {result['backup']}")
            print("  run `guster scan` to refresh the registry with the hub")
        return 0

    info = validate_hub(target, strict=action == "validate")
    if args.json:
        print(json_dumps(info))
    elif not args.quiet:
        manifest = info.get("manifest") or {}
        print(f"Hub:    {info['hub']}")
        if info.get("profile") == "legacy":
            print("Manifest: legacy (no hub.yaml)")
        else:
            print(
                "Manifest: "
                f"{info.get('profile') or '(absent)'} "
                f"schema={manifest.get('schema_version') or '(absent)'} "
                f"hub={manifest.get('hub_version') or '(absent)'} "
                f"min_guster={manifest.get('min_guster') or '(absent)'}"
            )
        print(f"Plugin: {info['plugin']}")
        paths = info.get("paths") or {}
        if paths:
            print(
                "Paths:  "
                f"knowledge={paths.get('knowledge', '(absent)')} "
                f"projects={paths.get('projects', '(absent)')} "
                f"tools={paths.get('tools', '(absent)')}"
            )
        if info["errors"]:
            for error in info["errors"]:
                print(f"  error: {error}")
        for warning in info["warnings"]:
            print(f"  warning: {warning}")
        if info["ok"]:
            print("Checks: OK")
    if action == "validate":
        return 0 if info["ok"] else 2
    return 0 if info["ok"] else 1


def cmd_zones(args: argparse.Namespace) -> int:
    state_dir = state_dir_from(args)
    config_path = state_dir / "config.json"
    config = load_config(config_path)
    action = args.zones_action

    if action == "list":
        zones = parse_zones(config.get("zones", []), config_path)
        if args.json:
            print(json_dumps({"zones": zones}))
        elif not args.quiet:
            if not zones:
                print("no zones configured; add one with `guster zones add <path>`")
            for item in zones:
                zone_path = Path(item["path"]).expanduser()
                print(f"{item['path']}  profile={item['profile']}  tools={count_zone_tools(zone_path)}")
        return 0

    zone_path = Path(args.path).expanduser()
    raw_zones = config.get("zones", [])
    if not isinstance(raw_zones, list):
        raise ValueError(f"Guster config 'zones' must be a list: {config_path}")

    if action == "add":
        if not zone_path.is_dir():
            raise ValueError(f"zone directory does not exist: {zone_path.resolve()}")
        for item in raw_zones:
            if isinstance(item, dict) and str(item.get("path", "")).strip():
                if Path(str(item["path"])).expanduser().resolve() == zone_path.resolve():
                    raise ValueError(f"zone already configured: {zone_path.resolve()}")
        entry = {"path": str(zone_path), "profile": args.profile}
        config.setdefault("version", 1)
        config["zones"] = raw_zones + [entry]
        zones = parse_zones(config["zones"], config_path)
        state_dir.mkdir(parents=True, exist_ok=True)
        save_json(config_path, config)
        if args.json:
            print(json_dumps({"ok": True, "added": entry, "zones": zones, "config": str(config_path)}))
        elif not args.quiet:
            print(f"added zone: {entry['path']} (profile: {entry['profile']})")
            print(f"config: {config_path}")
        return 0

    if action == "remove":
        remaining = [
            item
            for item in raw_zones
            if not (
                isinstance(item, dict)
                and str(item.get("path", "")).strip()
                and Path(str(item["path"])).expanduser().resolve() == zone_path.resolve()
            )
        ]
        if len(remaining) == len(raw_zones):
            raise ValueError(f"zone is not configured: {zone_path.resolve()}")
        if remaining:
            config["zones"] = remaining
        else:
            config.pop("zones", None)
        state_dir.mkdir(parents=True, exist_ok=True)
        save_json(config_path, config)
        if args.json:
            print(json_dumps({"ok": True, "removed": str(zone_path), "config": str(config_path)}))
        elif not args.quiet:
            print(f"removed zone: {zone_path}")
            print(f"config: {config_path}")
        return 0

    raise SystemExit(f"unknown zones action: {action}")


def cmd_link(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=True)
    result = evaluate(registry, config)
    findings = [item for item in result["policy"]["findings"] if item["rule"] == "broken-pointer"]
    if args.json:
        print(json_dumps({"findings": findings, "stats": result["policy"]["stats"]}))
    elif not args.quiet:
        print(f"broken pointer files: {len(findings)}")
        for item in findings:
            print(f"  {item['path']}")
            for pointer in item.get("evidence", {}).get("pointers", []):
                print(f"    - {pointer}")
    return 0 if not findings else 2


def cmd_export(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=True)
    result = evaluate(registry, config)
    report = render_report(registry, result["policy"], result["metrics"])
    out = Path(args.out).expanduser() if args.out else config.state_dir / "context-health.md"
    write_text(out, report)
    if args.format == "json":
        json_out = out.with_suffix(".json")
        save_json(json_out, {
            "registry": redacted_registry(registry),
            "policy": result["policy"],
            "metrics": result["metrics"],
        })
        if not args.quiet:
            print(f"report: {out}")
            print(f"json:   {json_out}")
    elif not args.quiet:
        print(f"report: {out}")
    return 0


def cmd_credentials(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=True)
    info = (registry.get("secrets") or {}).get("registry") or {}
    entries = info.get("entries") or []
    scopes: Dict[str, List[Dict[str, str]]] = {}
    for entry in entries:
        scopes.setdefault(entry.get("scope", "unknown"), []).append(entry)
    if args.json:
        print(json_dumps({"path": info.get("path"), "entries": entries}))
        return 0
    if not args.quiet:
        print(f"registry: {info.get('path') or '(missing)'}")
        for warning in info.get("parse_warnings") or []:
            print(f"  warning: {warning}")
        for scope in ("company", "personal", "unknown"):
            items = scopes.pop(scope, [])
            if not items:
                continue
            label = {"company": "company 公司", "personal": "personal 个人", "unknown": "unknown 未分类"}[scope]
            print(f"\n{label}（{len(items)}）")
            for entry in items:
                keys = f" [{entry['keys']}]" if entry.get("keys") not in {"", "-"} else ""
                print(f"  {entry['id']:24} {entry['site'][:16]:18} {entry['kind']:8} {entry['status']}{keys}")
        for scope, items in scopes.items():
            print(f"\n{scope}（{len(items)}）")
            for entry in items:
                print(f"  {entry['id']:24} {entry['site'][:16]:18} {entry['kind']:8} {entry['status']}")
    return 0


def cmd_upgrade(args: argparse.Namespace) -> int:
    config = build_config(args)
    registry = do_scan(config, write=True)
    manifests = registry.get("plugin_manifests", {})
    versions = {
        key: value.get("version")
        for key, value in manifests.items()
        if isinstance(value, dict) and value.get("exists")
    }
    if args.json:
        print(json_dumps({"plugin": __version__, "manifests": versions}))
    elif not args.quiet:
        print(f"Guster CLI: {__version__}")
        for key, version in versions.items():
            print(f"  {key}: {version or '(missing)'}")
        if len(set(versions.values())) > 1:
            print("  WARNING: manifest versions differ")
    return 0 if len(set(versions.values())) <= 1 else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="guster",
        description="Discover, audit, plan and evolve agent context.",
        epilog=(
            "Scans refresh Guster's state files; workspace writes need a plan with --yes. "
            "Exit codes: 1 tool/config error, 2 high findings, 3 critical findings, 4 plan refused at preflight."
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    add_common(common)

    status = subparsers.add_parser("status", parents=[common], help="Show plugin, registry and health status.")
    status.set_defaults(func=cmd_status)

    scan_parser = subparsers.add_parser("scan", parents=[common], help="Discover context assets.")
    scan_parser.add_argument("--no-write", action="store_true", help="Do not write registry.json.")
    scan_parser.set_defaults(func=cmd_scan)

    doctor = subparsers.add_parser("doctor", parents=[common], help="Run policy checks.")
    doctor.add_argument("--no-write", action="store_true", help="Do not write registry.json or findings.json.")
    doctor.set_defaults(func=cmd_doctor)

    score = subparsers.add_parser("score", parents=[common], help="Compute metrics and CHI.")
    score.add_argument("--write", action="store_true", help="Write metrics (default; kept for explicit scripts).")
    score.add_argument("--no-write", action="store_true", help="Do not write registry.json or append metrics.jsonl.")
    score.add_argument("--trend", action="store_true", help="Show the last 10 metric snapshots.")
    score.add_argument(
        "--fail-under",
        type=float,
        default=None,
        metavar="CHI",
        help="Exit 2 when CHI is below this value (opt-in gate for CI).",
    )
    score.set_defaults(func=cmd_score)

    check = subparsers.add_parser(
        "check",
        parents=[common],
        help="Run scan, doctor and score --trend in one pass.",
    )
    check.add_argument("--no-write", action="store_true", help="Do not write registry, findings or metrics.")
    check.set_defaults(func=cmd_check)

    zones_parser = subparsers.add_parser("zones", help="List or manage configured machine zones.")
    zones_sub = zones_parser.add_subparsers(dest="zones_action", required=True)
    zones_list = zones_sub.add_parser("list", parents=[common], help="List configured zones.")
    zones_list.set_defaults(func=cmd_zones)
    zones_add = zones_sub.add_parser("add", parents=[common], help="Add a zone to config.json.")
    zones_add.add_argument("path", help="Zone directory (must exist).")
    zones_add.add_argument("--profile", choices=["light", "full"], default="light", help="Zone profile.")
    zones_add.set_defaults(func=cmd_zones)
    zones_remove = zones_sub.add_parser("remove", parents=[common], help="Remove a configured zone.")
    zones_remove.add_argument("path", help="Zone directory as configured.")
    zones_remove.set_defaults(func=cmd_zones)

    plan = subparsers.add_parser("plan", help="Create a reviewable plan.")
    plan_sub = plan.add_subparsers(dest="plan_action", required=True)
    plan_findings = plan_sub.add_parser("findings", parents=[common], help="Turn findings into a review checklist.")
    plan_findings.set_defaults(func=cmd_plan)
    plan_move_parser = plan_sub.add_parser("move", parents=[common], help="Plan a move with backup and pointer.")
    plan_move_parser.add_argument("--from", dest="source", required=True, help="Source path.")
    plan_move_parser.add_argument("--to", dest="destination", required=True, help="Destination path.")
    plan_move_parser.set_defaults(func=cmd_plan)
    plan_init_parser = plan_sub.add_parser("init", parents=[common], help="Plan a standard .agents layout.")
    plan_init_parser.add_argument("--project", required=True, help="Project root.")
    plan_init_parser.set_defaults(func=cmd_plan)

    apply_parser = subparsers.add_parser("apply", parents=[common], help="Apply a plan.")
    apply_parser.add_argument("plan", help="Plan JSON path.")
    apply_parser.add_argument("--yes", action="store_true", help="Actually write; without it this is a dry run.")
    apply_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicit dry run (the default); cannot be combined with --yes.",
    )
    apply_parser.set_defaults(func=cmd_apply)

    init = subparsers.add_parser("init", parents=[common], help="Initialize Guster home or a project layout.")
    init.add_argument("--home", action="store_true", help="Initialize the Guster state home (default when --project is omitted).")
    init.add_argument("--project", default=None, help="Project root; omit to initialize the Guster state home.")
    init.add_argument("--yes", action="store_true", help="Actually write; without it this is a dry run.")
    init.set_defaults(func=cmd_init)

    hub = subparsers.add_parser("hub", help="Create, attach or inspect a Guster Hub.")
    hub_sub = hub.add_subparsers(dest="hub_action", required=True)
    hub_init = hub_sub.add_parser("init", parents=[common], help="Create a lite Guster Hub.")
    hub_init.add_argument("--path", default=None, help="Hub directory; defaults to the attached hub or the conventional Guster Hub path.")
    hub_init.add_argument("--name", default=None, help="Hub display name.")
    hub_init.add_argument("--knowledge", default="knowledge", help="Knowledge root relative to the hub.")
    hub_init.add_argument("--projects", default="projects", help="Project state root relative to the hub.")
    hub_init.add_argument("--tools", default="tools", help="Tool root relative to the hub.")
    hub_init.add_argument("--yes", action="store_true", help="Actually write; without it this is a dry run.")
    hub_init.set_defaults(func=cmd_hub)
    hub_attach = hub_sub.add_parser("attach", parents=[common], help="Attach an existing hub to Guster config.")
    hub_attach.add_argument("--path", default=None, help="Hub directory; defaults to the attached hub or the conventional Guster Hub path.")
    hub_attach.set_defaults(func=cmd_hub)
    hub_status = hub_sub.add_parser("status", parents=[common], help="Show hub manifest and validation status.")
    hub_status.add_argument("--path", default=None, help="Hub directory; defaults to the attached hub or the conventional Guster Hub path.")
    hub_status.set_defaults(func=cmd_hub)
    hub_validate = hub_sub.add_parser("validate", parents=[common], help="Validate a hub against the lite contract.")
    hub_validate.add_argument("--path", default=None, help="Hub directory; defaults to the attached hub or the conventional Guster Hub path.")
    hub_validate.set_defaults(func=cmd_hub)

    link = subparsers.add_parser("link", parents=[common], help="Check context pointers.")
    link.set_defaults(func=cmd_link)

    export = subparsers.add_parser("export", parents=[common], help="Export a redacted health report.")
    export.add_argument("--format", choices=["md", "json"], default="md")
    export.add_argument("--out", default=None, help="Output path.")
    export.set_defaults(func=cmd_export)

    creds = subparsers.add_parser("credentials", parents=[common], help="List registered credentials by scope.")
    creds.set_defaults(func=cmd_credentials)

    upgrade = subparsers.add_parser("upgrade", parents=[common], help="Check plugin manifest versions.")
    upgrade.set_defaults(func=cmd_upgrade)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except (ApplyError, OSError, ValueError) as exc:
        if getattr(args, "json", False):
            print(json_dumps({"ok": False, "error": str(exc)}))
        else:
            print(f"[guster] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
