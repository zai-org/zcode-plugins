from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from . import __version__
from .adapters import DeployError, adapter_for
from .config import LAYOUTS, STACKS, ConfigError, load_config, render_probe_expect
from .gates import check_learn, run_checks
from .layouts import layout_listing
from .loop import (
    CHECKS_PATH,
    dump_payload,
    infer_phase,
    next_payload,
    save_state,
    uncommitted_paths,
    update_agents_block,
)
from .ports import DeployContext, ProbeResult
from .templates import FileTemplateProvider, TemplateError
from .util import git_commit, now_iso, write_json


def _root(value: str) -> Path:
    return Path(value).expanduser().resolve()


def _sync_agents(root: Path, config) -> dict:
    payload = next_payload(root, config)
    update_agents_block(root, payload)
    save_state(root, payload)
    return payload


def cmd_init(args: argparse.Namespace) -> int:
    if args.list_layouts:
        print(layout_listing())
        return 0
    root = _root(args.path)
    if root.exists() and any(root.iterdir()) and not args.force:
        raise ConfigError(f"{root} is not empty; use --force to add Galadon files")
    root.mkdir(parents=True, exist_ok=True)
    name = args.name or root.name
    stack = args.stack if args.layout != "none" else "none"
    provider = FileTemplateProvider()
    result = provider.render(
        root,
        args.template,
        args.role,
        name,
        force=args.force,
        layout=args.layout,
        stack=stack,
    )
    for directory in ("spec", "wiki", "verify", "release", ".galadon"):
        (root / directory).mkdir(parents=True, exist_ok=True)
    config = load_config(root)
    payload = _sync_agents(root, config)
    if args.json:
        print(
            json.dumps(
                {
                    "root": str(root),
                    "layout": args.layout,
                    "stack": stack,
                    **result,
                    **payload,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"Galadon initialized: {root}")
        print(f"  template: {args.template}")
        print(f"  layout:   {args.layout} / {stack}")
        print(f"  role:     {args.role}")
        print(f"  phase:    {payload['phase']}")
        print(f"  next:     {payload['next']}")
    return 0


def cmd_next(args: argparse.Namespace) -> int:
    root = _root(args.path)
    config = load_config(root)
    payload = _sync_agents(root, config)
    if args.json:
        print(dump_payload(payload))
    else:
        print(f"{config.name}: {payload['phase']} / {payload['role']}")
        print(payload["next"])
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    root = _root(args.path)
    config = load_config(root)
    phase = infer_phase(root, config)
    report = check_learn(root, config) if phase == "learn" else run_checks(root, config)
    payload = _sync_agents(root, config)
    if args.json:
        print(json.dumps({**report, "next": payload}, ensure_ascii=False, indent=2))
    else:
        print(f"Galadon check: {'PASS' if report['ok'] else 'FAIL'}")
        for item in report["results"]:
            print(f"  [{item['code']}] {item['id']}: {item.get('stdout', '').strip()}")
        print(f"  phase: {payload['phase']}")
        print(f"  next:  {payload['next']}")
    return 0 if report["ok"] else 1


def cmd_new(args: argparse.Namespace) -> int:
    root = _root(args.path)
    config = load_config(root)
    phase = infer_phase(root, config)
    if phase != "done":
        raise ConfigError(
            f"the current loop is still in {phase}; finish it before starting a new one"
        )
    archive = root / ".galadon" / "history" / now_iso().replace(":", "-")
    archived: list[str] = []
    for relative in (CHECKS_PATH, config.paths.release):
        source = root / relative
        if source.is_file():
            archive.mkdir(parents=True, exist_ok=True)
            destination = archive / source.name
            shutil.move(str(source), str(destination))
            archived.append(str(destination.relative_to(root)))
    payload = _sync_agents(root, config)
    if args.json:
        print(json.dumps({"archived": archived, "next": payload}, ensure_ascii=False, indent=2))
    else:
        print(f"Galadon new loop: {config.name}")
        for item in archived:
            print(f"  archived: {item}")
        print(f"  phase: {payload['phase']}")
        print(f"  next:  {payload['next']}")
    return 0


def cmd_ship(args: argparse.Namespace) -> int:
    root = _root(args.path)
    config = load_config(root)
    env = args.env or config.deploy.env
    phase = infer_phase(root, config)
    if phase in {"learn", "done"}:
        raise ConfigError("this change has already shipped; write the retro or start a new spec")

    uncommitted = uncommitted_paths(root, config)
    if uncommitted:
        raise ConfigError(
            "uncommitted changes would ship under commit "
            f"{git_commit(root) or '(unknown)'}: {', '.join(uncommitted)}; commit them first"
        )

    report = run_checks(root, config)
    if not report["ok"]:
        payload = _sync_agents(root, config)
        print("Galadon ship refused: verification failed", file=sys.stderr)
        print(payload["next"], file=sys.stderr)
        return 2

    adapter = adapter_for(config.deploy.adapter)
    ctx = DeployContext(root=root, config=config, env=env)

    if args.dry_run:
        plan = {
            "project": config.name,
            "env": env,
            "adapter": adapter.name,
            "target": adapter.describe(ctx),
            "build": config.deploy.build or "(no command)",
            "migrate": config.deploy.migrate or "(no command)",
            "release": config.deploy.release or "(no command)",
            "probe": config.deploy.probe_url or "(not configured: ship will fail)",
        }
        if env == "prod":
            plan["requires"] = "--yes-prod"
        print(json.dumps(plan, ensure_ascii=False, indent=2) if args.json else "\n".join(f"{k}: {v}" for k, v in plan.items()))
        return 0

    if env == "prod" and not args.yes_prod:
        raise ConfigError("production release requires --yes-prod in the current session")

    print(f"Galadon ship: {env} -> {adapter.describe(ctx)}", file=sys.stderr)
    preflight = getattr(adapter, "preflight", None)
    if preflight is not None:
        result = preflight(ctx) or {}
        for note in result.get("notes") or []:
            print(f"galadon: {note}", file=sys.stderr)

    artifact = adapter.build(ctx)
    commit = git_commit(root)
    ctx.commit = commit
    if "{{COMMIT}}" in config.deploy.probe_expect:
        # Fail before building when the placeholder cannot render; adapters
        # render it against their own release commit, so the config must keep
        # the raw template for the rollback re-probe.
        render_probe_expect(config.deploy.probe_expect, commit)

    adapter.migrate(ctx)
    release = adapter.release(ctx, artifact)
    build_commit = str(release.metadata.get("commit") or commit or "")

    try:
        probe = adapter.probe(ctx, release)
    except DeployError as exc:
        probe = ProbeResult(ok=False, detail=str(exc), url=config.deploy.probe_url or None)

    rollback = None
    if not probe.ok:
        rollback = {
            "attempted": True,
            "ok": False,
            "version": None,
            "error": None,
            "probe": None,
        }
        try:
            adapter.rollback(ctx, release)
            info = release.metadata.get("rollback", {})
            rollback.update(info)
            rollback["attempted"] = True
            rollback["ok"] = bool(info.get("ok", True))
        except DeployError as exc:
            info = release.metadata.get("rollback", {})
            rollback.update(info)
            rollback["attempted"] = True
            rollback["ok"] = False
            rollback["error"] = str(exc)
        if rollback.get("ok"):
            live = rollback.get("actual") or rollback.get("version") or "(unknown)"
            target = f" at {rollback['target']}" if rollback.get("target") else ""
            print(
                f"galadon: probe failed; rolled back automatically: "
                f"release {live} is live again{target}",
                file=sys.stderr,
            )
        elif rollback.get("error"):
            print(
                f"galadon: probe failed; rollback failed: {rollback['error']}",
                file=sys.stderr,
            )

    actual_commit = probe.actual
    if rollback is not None and rollback.get("ok"):
        actual_commit = str(rollback.get("actual") or rollback.get("version") or "") or probe.actual
    record = {
        "ok": probe.ok,
        "at": now_iso(),
        "env": env,
        "adapter": adapter.name,
        "commit": build_commit or None,
        "actual_commit": actual_commit,
        "artifact": {
            "path": str(artifact.path.relative_to(root)) if artifact.path.is_relative_to(root) else str(artifact.path),
            "digest": artifact.digest,
        },
        "probe": {
            "ok": probe.ok,
            "detail": probe.detail,
            "url": probe.url,
            "actual": probe.actual,
        },
    }
    if rollback is not None:
        record["rollback"] = rollback
    write_json(root / config.paths.release, record)
    payload = _sync_agents(root, config)
    if args.json:
        print(json.dumps({"release": record, "next": payload}, ensure_ascii=False, indent=2))
    else:
        print(f"Galadon ship: {'PASS' if probe.ok else 'FAIL'} ({env})")
        print(f"  probe: {probe.detail}")
        if rollback is not None:
            if rollback.get("ok"):
                live = rollback.get("actual") or rollback.get("version")
                print(f"  rollback: release {live} is live again")
            elif rollback.get("error"):
                print(f"  rollback: failed: {rollback['error']}")
        print(f"  next:  {payload['next']}")
    return 0 if probe.ok else 1


def cmd_bootstrap(args: argparse.Namespace) -> int:
    root = _root(args.path)
    config = load_config(root)
    env = args.env or config.deploy.env
    if env == "prod" and not args.yes_prod:
        raise ConfigError("production bootstrap requires --yes-prod in the current session")
    adapter = adapter_for(config.deploy.adapter)
    ctx = DeployContext(root=root, config=config, env=env)
    print(f"Galadon bootstrap: {env} -> {adapter.describe(ctx)}", file=sys.stderr)
    result = adapter.bootstrap(ctx)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Galadon bootstrap: {env}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_teardown(args: argparse.Namespace) -> int:
    if not args.yes:
        raise ConfigError("teardown removes what bootstrap provisioned; pass --yes to confirm")
    root = _root(args.path)
    config = load_config(root)
    env = args.env or config.deploy.env
    if env == "prod" and not args.yes_prod:
        raise ConfigError("production teardown requires --yes-prod in the current session")
    adapter = adapter_for(config.deploy.adapter)
    ctx = DeployContext(root=root, config=config, env=env)
    print(f"Galadon teardown: {env} -> {adapter.describe(ctx)}", file=sys.stderr)
    result = adapter.teardown(ctx)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Galadon teardown: {env}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="galadon", description=__doc__)
    parser.add_argument("--version", action="version", version=f"galadon {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="Initialize an engineering workspace.")
    init.add_argument("--path", default=".", help="Target directory.")
    init.add_argument("--name", default="", help="Project name; defaults to the directory name.")
    init.add_argument("--template", choices=["web", "api", "static"], default="web")
    init.add_argument("--role", choices=["solo", "six-ring", "orchestrator"], default="solo")
    init.add_argument(
        "--layout",
        choices=list(LAYOUTS),
        default="none",
        help="Project layering contract; the default keeps 0.2.x behaviour.",
    )
    init.add_argument(
        "--stack",
        choices=list(STACKS),
        default="python",
        help="Code skeleton and checks; only used together with --layout.",
    )
    init.add_argument(
        "--list-layouts",
        action="store_true",
        help="Print the layouts and stacks this build ships, then exit.",
    )
    init.add_argument("--force", action="store_true", help="Add files to a non-empty directory.")
    init.add_argument("--json", action="store_true")
    init.set_defaults(func=cmd_init)

    next_cmd = sub.add_parser("next", help="Show the current phase and one next action.")
    next_cmd.add_argument("--path", default=".")
    next_cmd.add_argument("--json", action="store_true")
    next_cmd.set_defaults(func=cmd_next)

    check = sub.add_parser("check", help="Run the current phase gate.")
    check.add_argument("--path", default=".")
    check.add_argument("--json", action="store_true")
    check.set_defaults(func=cmd_check)

    new_cmd = sub.add_parser(
        "new", help="Start a new iteration by archiving the previous release and check records."
    )
    new_cmd.add_argument("--path", default=".")
    new_cmd.add_argument("--json", action="store_true")
    new_cmd.set_defaults(func=cmd_new)

    ship = sub.add_parser("ship", help="Build, verify, release and probe.")
    ship.add_argument("--path", default=".")
    ship.add_argument("--env", default="", help="Target environment; defaults to galadon.yaml.")
    ship.add_argument("--dry-run", action="store_true")
    ship.add_argument("--yes-prod", action="store_true", help="Confirm a production release.")
    ship.add_argument("--json", action="store_true")
    ship.set_defaults(func=cmd_ship)

    bootstrap = sub.add_parser("bootstrap", help="Provision the deployment target (adapter-defined).")
    bootstrap.add_argument("--path", default=".")
    bootstrap.add_argument("--env", default="")
    bootstrap.add_argument("--yes-prod", action="store_true", help="Confirm production provisioning.")
    bootstrap.add_argument("--json", action="store_true")
    bootstrap.set_defaults(func=cmd_bootstrap)

    teardown = sub.add_parser("teardown", help="Remove what bootstrap provisioned (adapter-defined).")
    teardown.add_argument("--path", default=".")
    teardown.add_argument("--env", default="")
    teardown.add_argument("--yes", action="store_true", help="Confirm the destructive teardown.")
    teardown.add_argument("--yes-prod", action="store_true", help="Confirm production teardown.")
    teardown.add_argument("--json", action="store_true")
    teardown.set_defaults(func=cmd_teardown)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except (ConfigError, TemplateError, DeployError, FileNotFoundError) as exc:
        print(f"galadon: {exc}", file=sys.stderr)
        return 2
