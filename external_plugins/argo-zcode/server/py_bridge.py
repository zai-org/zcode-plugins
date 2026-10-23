#!/usr/bin/env python3
"""argo-zcode 面板配置桥：被 panel_server.mjs 以子进程调用。

复用 argo 本体的 scripts/config.py（路径常量与加载器），不自行猜配置位置；
依赖 pyyaml——argo 唯一必需第三方依赖，装了 argo 就必有。
子命令：
  list-engines            引擎清单（config.yaml 基线 + config.local.yaml 覆盖合并后的有效值）
  set-engine NAME true|false   写覆盖层 config.local.yaml 的 engines.<name>.enabled
  env-path                输出 argo env 文件路径（密钥唯一真源）
"""
import json
import os
import sys


def _argo_scripts() -> str:
    home = os.environ.get("ARGO_HOME", "").strip()
    if not home:
        import shutil
        which = shutil.which("argo")
        if which:
            home = os.path.dirname(os.path.dirname(os.path.realpath(which)))
    if not home:
        for candidate in (
            os.path.expanduser("~/.agents/skills/argo"),
            os.path.expanduser("~/argo"),
        ):
            if os.path.isdir(os.path.join(candidate, "scripts")):
                home = candidate
                break
    if not home or not os.path.isdir(os.path.join(home, "scripts")):
        print(json.dumps({"error": "argo_not_found",
                          "hint": "未找到 argo 本体；设 ARGO_HOME 指向 argo 仓库根后重试"}))
        sys.exit(1)
    return os.path.join(home, "scripts")


def main() -> int:
    sys.path.insert(0, _argo_scripts())
    import yaml
    import config as argo_config  # argo 本体 scripts/config.py
    import argo_paths

    cmd = sys.argv[1] if len(sys.argv) > 1 else ""

    if cmd == "list-engines":
        cfg = argo_config.load_config()
        engines = []
        for name, spec in (cfg.get("engines") or {}).items():
            if not isinstance(spec, dict):
                continue
            engines.append({
                "name": name,
                "label": spec.get("label") or name,
                "enabled": bool(spec.get("enabled", True)),
                "cost_tier": spec.get("cost_tier"),
                "explicit_only": bool(spec.get("explicit_only")),
                "desc": (spec.get("desc") or "")[:140],
            })
        engines.sort(key=lambda e: (not e["enabled"], e["cost_tier"] != "free", e["name"]))
        print(json.dumps({"engines": engines}, ensure_ascii=False))
        return 0

    if cmd == "set-engine":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "usage: set-engine NAME true|false"}))
            return 1
        name, enabled = sys.argv[2], sys.argv[3] == "true"
        local = {}
        if argo_config.LOCAL_CONFIG_PATH.exists():
            local = yaml.safe_load(argo_config.LOCAL_CONFIG_PATH.read_text()) or {}
        if not isinstance(local, dict):
            local = {}
        local.setdefault("engines", {}).setdefault(name, {})["enabled"] = enabled
        argo_config.LOCAL_CONFIG_PATH.write_text(
            yaml.safe_dump(local, allow_unicode=True, sort_keys=True))
        print(json.dumps({"ok": True, "name": name, "enabled": enabled,
                          "path": str(argo_config.LOCAL_CONFIG_PATH)}))
        return 0

    if cmd == "env-path":
        paths = argo_paths.resolved_paths()
        print(json.dumps({"env_file": paths.get("env_files") or paths.get("env_file_in_use")}))
        return 0

    print(json.dumps({"error": f"unknown command: {cmd}"}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
