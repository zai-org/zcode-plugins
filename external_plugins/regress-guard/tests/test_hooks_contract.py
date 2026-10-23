"""hooks.json 插件契约（评审批次一 P0-2）。

病例（2026-09-08 评审 P0）：插件模式只装了 6 条钩子，边界守卫/执行阀/
失败采集/风险采集/压缩警告/轮末推送全部缺席——install.sh 注册的强制力
在插件模式下名存实亡；UserPromptSubmit 空 matcher 与自家 schema 教训矛盾。
"""
import json
import os

HOOKS = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "hooks", "hooks.json"))

# 每个事件里必须注册到的脚本名（与 install.sh 语义对齐）
REQUIRED = {
    "PreToolUse": ["launcher.js", "boundary_guard", "execution_valve",
                   "read_before_edit_guard"],
    "PostToolUse": ["risk_watch", "read_before_edit_guard", "plan_bridge"],
    "PostToolUseFailure": ["fail_watch", "plan_bridge"],
    "SessionStart": ["self_heal", "compact_notice"],
    "Stop": ["reflection_check", "stop_notify"],
    "UserPromptSubmit": ["prompt_intercept"],
}


def _events():
    h = json.load(open(HOOKS, encoding="utf-8"))
    return h.get("hooks") or h


def test_no_empty_matcher():
    """空 matcher 违反 schema（install.sh:214 自注：会致整份 config 被丢弃）。"""
    for ev, entries in _events().items():
        for e in entries:
            m = e.get("matcher")
            assert m not in ("",), f"{ev} 条目空 matcher——v1.27.1 教训重犯"
            if m is not None:
                assert isinstance(m, str) and m


def test_all_guards_registered():
    """六类缺席守卫全部在插件模式注册（P0-2 核心）。"""
    ev = _events()
    for event, names in REQUIRED.items():
        blob = json.dumps(ev.get(event, []), ensure_ascii=False)
        for name in names:
            assert name in blob, f"{event} 缺 {name} 注册——插件模式强制力缺席"


def test_stop_entry_no_matcher():
    """Stop 事件无 matcher 键（v1.34 已修，防回归）。"""
    for e in _events().get("Stop", []):
        assert "matcher" not in e


# ─── P1#6：卸载零残留契约（评审批次二） ────────────────────

def test_uninstall_covers_all_commands():
    """命令删除清单与 REQUIRED_COMMANDS 同源（漏一条=死文件）。"""
    UN = os.path.abspath(os.path.join(os.path.dirname(HOOKS), "..", "uninstall.sh"))
    src = open(UN, encoding="utf-8").read()
    for cmd in ("regress:resume", "regress:finish", "regress:stats",
                "regress:init", "regress:update"):
        assert cmd in src, f"uninstall.sh 漏删 {cmd}"


def test_uninstall_filters_all_guard_scripts():
    """统一过滤覆盖全部守卫脚本名（漏一个=卸载后死钩子）。"""
    UN = os.path.abspath(os.path.join(os.path.dirname(HOOKS), "..", "uninstall.sh"))
    src = open(UN, encoding="utf-8").read()
    for name in ("stop_notify", "boundary_guard", "execution_valve",
                 "fail_watch", "risk_watch", "compact_notice", "prompt_intercept",
                 "plan_bridge"):
        assert name in src, f"uninstall 过滤漏 {name}"


def test_install_copies_every_hook_script():
    """install.sh cp 清单覆盖 hooks.json 全部脚本（v1.39，stop_notify 病例
    的通用化收口：注册了却从不拷贝——装到自愈前每轮报文件不存在）。

    派生优于断言：脚本名从 hooks.json 命令里提取，新增钩子自动进契约。
    self_heal.py 例外（拷进 lib/）；lib 下 *.py 走通配整目录拷贝。"""
    import re
    INS = os.path.abspath(os.path.join(os.path.dirname(HOOKS), "..", "install.sh"))
    src = open(INS, encoding="utf-8").read()
    names = set()
    for entries in _events().values():
        for e in entries:
            for h in e.get("hooks", []):
                for m in re.finditer(r"([\w-]+\.(?:py|js))",
                                     str(h.get("command", ""))):
                    names.add(m.group(1))
    for n in sorted(names):
        if n == "self_heal.py":
            continue
        assert f'cp "${{PLUGIN_ROOT}}/hooks/scripts/{n}"' in src, \
            f"install.sh 未拷贝 {n}（stop_notify 病例重犯）"


def test_install_registers_every_hooks_json_script():
    """install.sh 注册面覆盖 hooks.json 全部脚本（v1.43，自迭代 B5）。

    与 cp 清单测试互补的另一方向：cp 清单管"文件到不到"，本测试管
    "config.json 里挂不挂"——插件模式有、脚本安装模式无的 P0-2 漂移，
    在测试期被拦而不是装机后靠会话报错发现。
    判据：脚本名须出现在 install.sh 的注册段（Python heredoc 内），
    裸 cp 行不算注册。launcher.js 走 process 入口（"launcher.js" 字样）。"""
    import re
    INS = os.path.abspath(os.path.join(os.path.dirname(HOOKS), "..", "install.sh"))
    src = open(INS, encoding="utf-8").read()
    # 注册段=操作 events 的 heredoc（按内容特征定位：split("PYEOF") 会被
    # 注释里的 PYEOF 字样骗到，part 序号不稳定——实测注释提到 PYEOF 一次）
    parts = src.split("PYEOF")
    pyeof = next((p for p in parts if "events.get(" in p), src)
    names = set()
    for entries in _events().values():
        for e in entries:
            for h in e.get("hooks", []):
                for m in re.finditer(r"([\w-]+\.(?:py|js))",
                                     str(h.get("command", ""))):
                    names.add(m.group(1))
    for n in sorted(names):
        stem = n.rsplit(".", 1)[0]
        assert stem in pyeof, \
            f"install.sh 注册段未出现 {stem}——脚本模式装完钩子不生效（P0-2 族）"


def test_command_synced_in_selfheal_and_uninstall():
    """命令三侧同步（v1.45，B7）：commands/ 文件 ↔ self_heal REQUIRED_COMMANDS
    ↔ uninstall 删除清单——漏一侧=死文件（自愈不恢复）或卸载残留。

    派生优于断言：从 commands/ 目录 glob，新增命令自动进契约。"""
    import glob
    ROOT = os.path.abspath(os.path.join(os.path.dirname(HOOKS), ".."))
    cmds = sorted(os.path.basename(p)[:-3]
                  for p in glob.glob(os.path.join(ROOT, "commands", "*.md")))
    assert len(cmds) >= 15, f"命令数异常少（{len(cmds)}）——glob 疑未命中"
    sh = open(os.path.join(ROOT, "hooks", "scripts", "self_heal.py"),
              encoding="utf-8").read()
    un = open(os.path.join(ROOT, "uninstall.sh"), encoding="utf-8").read()
    for c in cmds:
        assert c in sh, f"self_heal REQUIRED_COMMANDS 漏 {c}（自愈不恢复=死文件）"
        assert c in un, f"uninstall 漏删 {c}（卸载残留）"
