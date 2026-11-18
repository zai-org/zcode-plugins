from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import ProjectConfig
from .layouts import MISSING_CHECKS, layout_contract_problems
from .loop import CHECKS_PATH, retro_ok, spec_ok
from .util import now_iso, run_shell, write_json


def _tail(text: str, limit: int = 2000) -> str:
    text = text.strip()
    return text[-limit:] if len(text) > limit else text


def _write_evidence(root: Path, config: ProjectConfig, report: dict[str, Any]) -> None:
    lines = [
        "# Verification evidence",
        "",
        f"- at: {report['at']}",
        f"- ok: {report['ok']}",
        "",
    ]
    for item in report["results"]:
        lines.extend(
            [
                f"## {item['id']}",
                "",
                f"- command: `{item['command']}`",
                f"- exit: {item['code']}",
            ]
        )
        if item.get("stdout"):
            lines.extend(["", "```text", item["stdout"], "```"])
        if item.get("stderr"):
            lines.extend(["", "```text", item["stderr"], "```"])
        lines.append("")
    path = root / config.paths.evidence
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def layout_result(root: Path, config: ProjectConfig) -> dict[str, Any]:
    problems = layout_contract_problems(root, config)
    detail = (
        f"layout contract ({config.layout}) is complete"
        if not problems
        else f"layout contract ({config.layout}) missing: " + "; ".join(problems)
    )
    return {
        "id": "layout",
        "command": "",
        "code": 0 if not problems else 1,
        "stdout": detail,
        "stderr": "",
    }


def run_checks(root: Path, config: ProjectConfig) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    ok, detail = spec_ok(root, config)
    results.append({"id": "spec", "command": "", "code": 0 if ok else 1, "stdout": detail, "stderr": ""})

    if ok and config.layout != "none":
        layout = layout_result(root, config)
        results.append(layout)
        if layout["code"] != 0:
            ok = False

    if ok:
        commands = (
            ("build", config.checks.build.strip()),
            ("test", config.checks.test.strip()),
        )
        if not any(command for _, command in commands):
            ok = False
            results.append(
                {
                    "id": "checks",
                    "command": "",
                    "code": 1,
                    "stdout": MISSING_CHECKS,
                    "stderr": "",
                }
            )
        else:
            for check_id, command in commands:
                if not command:
                    ok = False
                    results.append(
                        {
                            "id": check_id,
                            "command": "",
                            "code": 1,
                            "stdout": (
                                f"checks.{check_id} is not configured — "
                                "declare checks.build/checks.test"
                            ),
                            "stderr": "",
                        }
                    )
                    continue
                code, stdout, stderr = run_shell(command, root, timeout=config.checks.timeout)
                results.append(
                    {
                        "id": check_id,
                        "command": command,
                        "code": code,
                        "stdout": _tail(stdout),
                        "stderr": _tail(stderr),
                    }
                )
                if code != 0:
                    ok = False

    report = {
        "ok": ok,
        "at": now_iso(),
        "phase": "verify",
        "results": results,
    }
    write_json(root / CHECKS_PATH, report)
    _write_evidence(root, config, report)
    return report


def check_learn(root: Path, config: ProjectConfig) -> dict[str, Any]:
    ok, detail = retro_ok(root, config)
    results: list[dict[str, Any]] = [
        {
            "id": "learn",
            "command": "",
            "code": 0 if ok else 1,
            "stdout": detail,
            "stderr": "",
        }
    ]
    if config.layout != "none":
        layout = layout_result(root, config)
        results.append(layout)
        if layout["code"] != 0:
            ok = False
    return {
        "ok": ok,
        "at": now_iso(),
        "phase": "learn",
        "results": results,
    }
