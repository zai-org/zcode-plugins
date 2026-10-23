"""marketplace 就绪合同（v1.81，070）：源码仓=插件形态的分发就绪四查。

源码考证（ZCode 3.14.0 开源仓）：宿主自动发现 <插件根>/hooks/hooks.json 并在
运行时与用户 config 合并；${ZCODE_PLUGIN_ROOT} 展开为安装缓存根——绝对路径
会破功。本合同锁住就绪形态不被后续改动悄悄破坏。"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def test_marketplace_manifest_shape():
    """services 侧 parseMarketplaceManifest 最小字段：name + plugins[].name。"""
    d = json.load(open(os.path.join(ROOT, "marketplace.json"), encoding="utf-8"))
    assert isinstance(d.get("name"), str) and d["name"].strip()
    plugins = d.get("plugins")
    assert isinstance(plugins, list) and plugins, "plugins 数组非空"
    entry = plugins[0]
    assert isinstance(entry.get("name"), str) and entry["name"] == "regress-guard"
    assert str(entry.get("source", "")).strip(), "entry source 在场（./ 仓根即插件根）"


def test_plugin_manifest_name_pattern_and_root():
    """plugin.json name 合法模式 + .zcode-plugin 在仓根（findManifest 第一优先）。"""
    d = json.load(open(os.path.join(ROOT, ".zcode-plugin", "plugin.json"),
                       encoding="utf-8"))
    assert re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", d["name"])
    assert os.path.isfile(os.path.join(ROOT, "hooks", "hooks.json"))


def test_hooks_json_all_plugin_relative():
    """全部 command 走 ${ZCODE_PLUGIN_ROOT}，零绝对家目录——插件形态不破功。"""
    d = json.load(open(os.path.join(ROOT, "hooks", "hooks.json"), encoding="utf-8"))
    cmds = []
    for ev, matchers in (d.get("hooks") or {}).items():
        for m in matchers:
            for h in m.get("hooks", []):
                cmds.append(str(h.get("command", "")))
    assert cmds, "hooks.json 有命令"
    assert all("ZCODE_PLUGIN_ROOT" in c for c in cmds), "全部命令插件根相对"
    assert not any(re.search(r"(/home/|(?<![$\w])~/)", c) for c in cmds), \
        "无绝对家目录路径"


def test_hooks_json_events_supported():
    """事件名全部在宿主 7 事件集合（未知事件仅 warning 不装载）。"""
    d = json.load(open(os.path.join(ROOT, "hooks", "hooks.json"), encoding="utf-8"))
    supported = {"SessionStart", "UserPromptSubmit", "PreToolUse",
                 "PermissionRequest", "PostToolUse", "PostToolUseFailure", "Stop"}
    for ev in (d.get("hooks") or {}):
        assert ev in supported, f"未知事件 {ev}"
