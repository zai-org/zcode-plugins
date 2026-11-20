#!/usr/bin/env python3
"""rfauto ZCode 插件 MCP 启动器（仅标准库）。

解释器解析顺序（前一步可用即采用；全部失败则进入诊断模式，不让宿主无声挂起）：

1. 配置了 RFAUTO_PYTHON：用该解释器派生 ``python -m rfauto.mcp_server``。
   RFAUTO_SRC 为目录时前置到子进程的 PYTHONPATH，使指定源码树优先于已安装的包。
   stdin/stdout 以原始文件句柄直接交给子进程，由它在信道上直接说 MCP，启动器不做任何加帧。
2. 未配置：在本进程内导入 ``rfauto.mcp_server``（导入期间 stdout 重定向到 stderr，
   杂散的 print 不会污染 JSON-RPC 信道）。导入成功则交给其 ``main()`` 接管。
3. 导入失败：运行最小诊断服务器，只暴露 ``rf_env_doctor`` 一个工具，
   报告缺什么、该运行哪条命令、该配哪项 userConfig。

配置值为空串或未解析的 ``${user_config.*}`` 字面量，一律视为未配置。诊断信息只写入
stderr。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from contextlib import redirect_stdout

PLUGIN_ROOT = os.environ.get("RFAUTO_PLUGIN_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER_MODULE = "rfauto.mcp_server"
# 安装命令固定到公开仓 GitHub Release v0.14.0 的源码包（提交 3d7b15d，URL 内含 SHA256 摘要）。升级时同步修改本行、INSTALL_ALT 与 plugin.json 的 userConfig 说明。
INSTALL_CMD = 'pip install "rfauto[mcp] @ https://github.com/geer1895/rfauto/releases/download/v0.14.0/rfauto-0.14.0-source.zip#sha256=47b2a7db4a6345d1d92cd038d275d75be3edbd8f40ecd5db327a79c05b8ebe6d"'
INSTALL_ALT = 'pip install "rfauto[mcp] @ git+https://github.com/geer1895/rfauto.git@v0.14.0"'   # 需要 git 且能连通 github.com


def _cfg(name: str) -> str:
    """读配置环境变量；空串或未解析的模板字面量按未配置处理。"""
    v = os.environ.get(name, "").strip()
    if not v or v.startswith("${"):
        return ""
    return v


def _load_cfg_file() -> dict:
    """后备配置：``$RFAUTO_PLUGIN_DATA/launcher.json``，键 pythonPath/rfautoSrc。

    环境变量（userConfig）优先于本文件。
    """
    data_dir = os.environ.get("RFAUTO_PLUGIN_DATA", "").strip()
    if not data_dir or data_dir.startswith("${"):
        return {}
    path = os.path.join(data_dir, "launcher.json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                cfg = json.load(f)
            if isinstance(cfg, dict):
                cfg["_path"] = path
                return cfg
        except Exception as exc:  # noqa: BLE001 - 报告异常，不崩会话
            print(f"[rfauto-plugin] 配置文件无效 {path}: {exc}", file=sys.stderr)
    return {}


def _resolve_config() -> tuple[str, str, str]:
    """返回 (python_path, rfauto_src, 来源说明)。"""
    file_cfg = _load_cfg_file()
    py = _cfg("RFAUTO_PYTHON") or str(file_cfg.get("pythonPath") or "").strip()
    src = _cfg("RFAUTO_SRC") or str(file_cfg.get("rfautoSrc") or "").strip()
    origin = "userConfig 环境变量" if _cfg("RFAUTO_PYTHON") else (
        f"配置文件 {file_cfg.get('_path')}" if file_cfg.get("pythonPath") else "未配置")
    return py, src, origin


def _spawn_child(exe: str, src: str) -> int:
    """以 ``exe -m rfauto.mcp_server`` 启动子进程，stdio 句柄直接传入，启动器不做转发。

    先净化子进程环境。宿主可能注入其自带解释器的 PYTHONHOME/PYTHONPATH（实测嵌入式
    打包的 Python 会这样），版本不一致的 venv 子进程会因 SRE 模块不匹配而崩溃。
    子进程只保留 PYTHONPATH=RFAUTO_SRC，PYTHONHOME 一律不传。
    """
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    if src and os.path.isdir(src):
        env["PYTHONPATH"] = src
    else:
        env.pop("PYTHONPATH", None)
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    cmd = [exe, "-m", "rfauto.mcp_server"]
    print(f"[rfauto-plugin] 启动：{' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.Popen(
        cmd,
        env=env,
        stdin=sys.stdin.buffer,
        stdout=sys.stdout.buffer,
        stderr=sys.stderr,
    )
    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        return 130


# ─────────────────────────── 诊断兜底 ────────────────────────────

def _env_report() -> dict:
    """收集服务器无法启动的原因所需的全部信息。"""
    cfg_python_cfg = _cfg("RFAUTO_PYTHON")
    cfg_src_cfg = _cfg("RFAUTO_SRC")
    rep: dict = {
        "launcher_python": sys.executable,
        "launcher_python_version": sys.version.split()[0],
        "rfauto_python_configured": cfg_python_cfg or "（未设置）",
        "rfauto_src_configured": cfg_src_cfg or "（未设置）",
        "checks": [],
    }
    file_cfg = _load_cfg_file()
    data_env = os.environ.get("RFAUTO_PLUGIN_DATA", "").strip()
    rep["config_file"] = file_cfg.get("_path") or (
        os.path.join(data_env, "launcher.json")
        if data_env and not data_env.startswith("${")
        else "（无插件数据目录）"
    )
    cfg_exe, _cfg_src, cfg_origin = _resolve_config()
    exe_ok = bool(cfg_exe) and (os.path.isfile(cfg_exe) or shutil.which(cfg_exe) is not None)
    rep["checks"].append(
        {
            "name": "configured_interpreter",
            "ok": exe_ok if cfg_exe else None,
            "detail": (
                f"pythonPath（来自{cfg_origin}）已找到" if exe_ok
                else f"pythonPath（来自{cfg_origin}）在本机不存在" if cfg_exe
                else f"未配置解释器：请在插件设置中填写 pythonPath，或向 {rep['config_file']} "
                     '写入 {"pythonPath": "..."}'
            ),
        }
    )
    try:
        import rfauto  # noqa: F401

        version = getattr(rfauto, "__version__", None)
        rep["checks"].append(
            {"name": "rfauto_import", "ok": True,
             "detail": f"rfauto {version or '（版本未知）'}，位置 {os.path.dirname(rfauto.__file__)}"}
        )
    except Exception as exc:  # noqa: BLE001
        rep["checks"].append(
            {
                "name": "rfauto_import",
                "ok": False,
                "detail": f"rfauto 不可导入（{exc}）。先安装：{INSTALL_CMD}；"
                          "然后把装好它的解释器填入插件 pythonPath，"
                          "或把 rfautoSrc 指向某个检出目录的 src/。",
            }
        )
    try:
        import fastmcp  # noqa: F401

        rep["checks"].append(
            {"name": "fastmcp_import", "ok": True,
             "detail": f"fastmcp {getattr(fastmcp, '__version__', '?')}"}
        )
    except Exception as exc:  # noqa: BLE001
        rep["checks"].append(
            {"name": "fastmcp_import", "ok": False,
             "detail": f"缺少 fastmcp（{exc}）。它随 [mcp] extra 一起安装：{INSTALL_CMD}"}
        )
    rep["ok"] = all(c["ok"] is not False for c in rep["checks"])
    return rep


_DIAG_TOOL = {
    "name": "rf_env_doctor",
    "description": (
        "报告 rfauto MCP 服务器无法启动的原因：检查配置的解释器，以及 rfauto 与 fastmcp "
        "能否导入，并给出确切的安装命令和需要配置的 userConfig 项。可随时调用，无副作用。"
    ),
    "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
}

_DIAG_INSTRUCTIONS = (
    "rfauto MCP 服务器未能启动。请先安装 rfauto：\n"
    f"  {INSTALL_CMD}\n"
    f"  或从 git 标签安装（需要 git 且能连通 github.com）：{INSTALL_ALT}\n"
    "然后二选一：(a) 若它装在运行本启动器的解释器里，userConfig.pythonPath 留空；"
    "(b) 把 userConfig.pythonPath 指向任一装有 rfauto 的 Python 3.10–3.12 解释器。"
    "可选：把 userConfig.rfautoSrc 指向 rfauto 检出目录的 src/，以锁定源码树。"
    "完成后重启会话，MCP 服务器会重新拉起。"
)


def _diag_send(msg: dict) -> None:
    sys.stdout.buffer.write((json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def run_diagnostic_server(reason: str) -> int:
    """行分隔 JSON-RPC 循环，仅暴露 rf_env_doctor。不抛异常。"""
    print(f"[rfauto-plugin] 诊断模式：{reason}", file=sys.stderr)
    for raw in sys.stdin.buffer:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line.decode("utf-8"))
        except Exception:
            continue
        method = req.get("method", "")
        req_id = req.get("id")
        if method == "initialize":
            params = req.get("params") or {}
            _diag_send(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                        "capabilities": {"tools": {}},
                        "serverInfo": {
                            "name": "rfauto-plugin-bootstrap",
                            "version": "0.1.0",
                        },
                    },
                }
            )
        elif method == "tools/list":
            _diag_send(
                {"jsonrpc": "2.0", "id": req_id, "result": {"tools": [_DIAG_TOOL]}}
            )
        elif method == "tools/call":
            rep = _env_report()
            lines = [
                "## rfauto 插件环境报告",
                f"- 启动器 Python：{rep['launcher_python']}（{rep['launcher_python_version']}）",
                f"- userConfig.pythonPath：{rep['rfauto_python_configured']}",
                f"- userConfig.rfautoSrc：{rep['rfauto_src_configured']}",
                f"- 后备配置文件：{rep['config_file']}",
                "",
            ]
            for c in rep["checks"]:
                mark = {True: "PASS", False: "FAIL", None: "SKIP"}[c["ok"]]
                lines.append(f"- [{mark}] {c['name']}：{c['detail']}")
            lines += ["", _DIAG_INSTRUCTIONS]
            _diag_send(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": "\n".join(lines)}],
                        "isError": not rep["ok"],
                    },
                }
            )
        elif method == "ping":
            _diag_send({"jsonrpc": "2.0", "id": req_id, "result": {}})
        elif method.startswith("notifications/"):
            pass
        elif req_id is not None:
            _diag_send(
                {"jsonrpc": "2.0", "id": req_id,
                 "error": {"code": -32601, "message": "当前为诊断模式，不支持该方法"}}
            )
    return 0


def main() -> int:
    cfg_python, cfg_src, cfg_origin = _resolve_config()

    if cfg_python:
        exe = shutil.which(cfg_python) or cfg_python
        if os.path.isfile(exe):
            try:
                return _spawn_child(exe, cfg_src)
            except OSError as exc:
                print(f"[rfauto-plugin] 派生失败：{exc}", file=sys.stderr)
                return run_diagnostic_server(f"配置的解释器无法派生：{cfg_python}")
        return run_diagnostic_server(f"配置的 pythonPath 不存在：{cfg_python}（{cfg_origin}）")

    mod = _import_rfauto_mcp(cfg_src)
    if mod is not None:
        try:
            mod.main()  # 进入 fastmcp 的 stdio 循环，此后 stdout 归它所有
            return 0
        except SystemExit as exc:  # fastmcp 关停时可能抛 SystemExit
            return int(exc.code or 0)
        except KeyboardInterrupt:
            return 130
    return run_diagnostic_server(f"{SERVER_MODULE} 在 {sys.executable} 上不可导入")


def _import_rfauto_mcp(src: str):
    """进程内导入服务器模块；失败返回 None。"""
    if src and os.path.isdir(src):
        sys.path.insert(0, src)
    try:
        with redirect_stdout(sys.stderr):
            if SERVER_MODULE in sys.modules:
                del sys.modules[SERVER_MODULE]
            import importlib

            return importlib.import_module(SERVER_MODULE)
    except Exception as exc:  # noqa: BLE001 - 诊断路径负责报告
        print(f"[rfauto-plugin] 进程内导入失败：{exc}", file=sys.stderr)
        return None


if __name__ == "__main__":
    sys.exit(main())
