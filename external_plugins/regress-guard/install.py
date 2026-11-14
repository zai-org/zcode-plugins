#!/usr/bin/env python3
"""regress-guard 一键安装器（批191 Python 化：Windows 10+ 原生可用）。

用法：python install.py   （POSIX 也可 bash install.sh——薄委托本脚本）

做的事：
  1. 把所有命令复制到 ~/.zcode/commands/（v1.95.1 起不再装 skill）
  2. 把 hook 脚本复制到 ~/.zcode/regress-guard-hooks/
  3. 在 ~/.zcode/cli/config.json 注册 hook（批191 起全部经 launcher.js
     路由：node 必有 + 由它探测 python3/python/py——Windows 无 python3 直调）
  4. 在 ~/.zcode/AGENTS.md 注入回归契约

幂等：重复运行不会重复添加，只会更新。
REGRESS_ZCODE_HOME 可覆写目标根（沙箱测试）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime

PLUGIN_ROOT = os.path.dirname(os.path.abspath(__file__))
ZCODE_HOME = os.environ.get("REGRESS_ZCODE_HOME") or os.path.join(os.path.expanduser("~"), ".zcode")
COMMANDS_DIR = os.path.join(ZCODE_HOME, "commands")
HOOK_HOME = os.path.join(ZCODE_HOME, "regress-guard-hooks")
CONFIG_FILE = os.path.join(ZCODE_HOME, "cli", "config.json")
AGENTS_FILE = os.path.join(ZCODE_HOME, "AGENTS.md")

# 摊平拷贝的入口脚本（源 hooks/scripts/ → HOOK_HOME 根）。
# 与 hooks.json 的 launcher 参数一一对应（契约：test_install_copies_every_hook_script）。
ENTRY_SCRIPTS = [
    "launcher.js",
    "pre_commit_guard.py",
    "read_before_edit_guard.py",
    "prompt_intercept.py",
    "reflection_check.py",
    "fail_watch.py",
    "risk_watch.py",
    "compact_notice.py",
    "execution_valve.py",
    "boundary_guard.py",
    "stop_notify.py",
    "plan_bridge.py",
]
# self_heal 特例：摊平布局放 lib/（历史契约，self_heal 自身驻 lib/）


def info(msg: str) -> None:
    print("✅ " + msg)


def warn(msg: str) -> None:
    print("⚠️  " + msg)


def error(msg: str) -> None:
    print("❌ " + msg)


def preflight() -> None:
    if not os.path.isdir(ZCODE_HOME):
        error(f"未找到 {ZCODE_HOME} 目录。请确认已安装 ZCode。")
        sys.exit(1)
    if shutil.which("node") is None:
        error("未找到 node。ZCode 需要 Node.js 运行时。")
        sys.exit(1)
    # 版本门（README 声明 3.10+；批138 教训：晦涩语法失败不如明确退出）。
    # 本脚本自身就跑在目标 Python 里——直接查运行时，无需二次探测。
    if sys.version_info < (3, 10):
        error(f"Python 版本过低：{sys.version.split()[0]}（需 3.10+）")
        error("  升级路径：uv python install 3.12 / pyenv install 3.12 / python.org")
        sys.exit(1)


def copy_files() -> None:
    os.makedirs(COMMANDS_DIR, exist_ok=True)
    # 批192：清扫旧冒号命名残留（NTFS 非法字符——改名前装的 regress:*.md
    # 在新版卸载清单外成死文件，升级路径上原地回收）
    for name in os.listdir(COMMANDS_DIR):
        if name.startswith("regress:") and name.endswith(".md"):
            try:
                os.remove(os.path.join(COMMANDS_DIR, name))
                info(f"回收旧命名残留: {name}")
            except OSError:
                pass
    for name in sorted(os.listdir(os.path.join(PLUGIN_ROOT, "commands"))):
        if name.endswith(".md"):
            shutil.copy2(os.path.join(PLUGIN_ROOT, "commands", name), COMMANDS_DIR)
            info(f"command: {name[:-3]}")

    # hook 脚本摊平到 HOOK_HOME（用户级 config.json 不支持 ${ZCODE_PLUGIN_ROOT}）
    os.makedirs(os.path.join(HOOK_HOME, "lib"), exist_ok=True)
    for n in ENTRY_SCRIPTS:
        shutil.copy2(os.path.join(PLUGIN_ROOT, "hooks", "scripts", n), HOOK_HOME)
    shutil.copy2(os.path.join(PLUGIN_ROOT, "hooks", "scripts", "self_heal.py"),
                 os.path.join(HOOK_HOME, "lib"))
    # 120：清历史残留死文件（注册位在 lib/，根位置曾致哨兵巡检误跑旧版）
    stale = os.path.join(HOOK_HOME, "self_heal.py")
    if os.path.exists(stale):
        os.remove(stale)
    shutil.copy2(os.path.join(PLUGIN_ROOT, "scripts", "heldout_gate.py"), HOOK_HOME)  # 119：held-out 门部署契约
    for n in sorted(os.listdir(os.path.join(PLUGIN_ROOT, "hooks", "scripts", "lib"))):
        if n.endswith(".py"):
            shutil.copy2(os.path.join(PLUGIN_ROOT, "hooks", "scripts", "lib", n),
                         os.path.join(HOOK_HOME, "lib"))
    tpl_src = os.path.join(PLUGIN_ROOT, "templates")
    tpl_dst = os.path.join(HOOK_HOME, "templates")
    os.makedirs(tpl_dst, exist_ok=True)
    for n in sorted(os.listdir(tpl_src)):  # v1.26.1：全部模板（缺部署会断 init 链）
        if n.endswith(".md"):
            shutil.copy2(os.path.join(tpl_src, n), tpl_dst)
    # 批222：装机树版本档随装刷新——.zcode-plugin/plugin.json 曾由市场形态安装器
    # （或旧流程）留档而拷贝段不覆盖，冻结在首装版本（标本：残档 2.8.4 vs
    # .source 2.8.21，run68 取证被骗两次）。.source 仍是 post_install_check 的
    # 优先真源；本刷新让两档恒一致，未知读者不再读到失真版本。
    zp_dst = os.path.join(HOOK_HOME, ".zcode-plugin")
    os.makedirs(zp_dst, exist_ok=True)
    shutil.copy2(os.path.join(PLUGIN_ROOT, ".zcode-plugin", "plugin.json"),
                 os.path.join(zp_dst, "plugin.json"))
    # chmod +x 保险（Windows 上等价 no-op，不失败）
    for n in ENTRY_SCRIPTS:
        try:
            os.chmod(os.path.join(HOOK_HOME, n), 0o755)
        except OSError:
            pass
    info(f"hook 脚本 → {HOOK_HOME}")


def _launcher_cmd(hook_home: str, script: str, *args: str) -> str:
    """统一 hook 命令形态：node launcher.js <script> [args]（批191）。

    命令串无 shell 元字符（仅双引号包路径），cmd.exe 与 POSIX sh 双合法；
    解释器探测（python3/python/py）由 launcher 完成。"""
    return f'node "{os.path.join(hook_home, "launcher.js")}" {script}' + \
        ("".join(f" {a}" for a in args))


def register_hooks() -> None:
    """hook 注册到 config.json（幂等：按脚本名摘旧再挂新，兼容摘 python3 直调遗留）。"""
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)

    config: dict = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, encoding="utf-8") as f:
                config = json.load(f)
            if not isinstance(config, dict):
                config = {}
        except Exception:
            config = {}

    config.setdefault("hooks", {})
    config["hooks"]["enabled"] = True
    events = config["hooks"].setdefault("events", {})

    def _drop(entries, *tokens):
        """摘除含任一 token 的条目（条目内其他 hook 保留）。"""
        return [e for e in entries
                if not any(t in json.dumps(e, ensure_ascii=False) for t in tokens)]

    # PreToolUse(Bash): launcher 提交门禁（process 型，唯一非 command 型）
    hook_entry = {
        "type": "process",
        "command": "node",
        "args": [os.path.join(HOOK_HOME, "launcher.js")],
        "timeoutMs": 180000,
        "statusMessage": "regress-guard: 运行测试验证...",
    }
    pretool = _drop(events.get("PreToolUse", []), "launcher.js")
    # 逐条目摘旧 launcher（保留条目内其他 hook），再挂进 Bash matcher
    for e in pretool:
        e["hooks"] = [h for h in e.get("hooks", [])
                      if "launcher.js" not in json.dumps(h)]
    for e in pretool:
        if e.get("matcher") == "Bash":
            e["hooks"].append(hook_entry)
            break
    else:
        pretool.append({"matcher": "Bash", "hooks": [hook_entry]})
    events["PreToolUse"] = pretool

    # SessionStart 自愈（每次启动检查文件完整性）
    selfheal_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "lib/self_heal.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 检查完整性...",
    }
    events["SessionStart"] = _drop(events.get("SessionStart", []), "self_heal") + [
        {"matcher": "startup", "hooks": [selfheal_entry]}]

    # 先读后改门禁（PreToolUse 拦 Edit/Write + PostToolUse 记 Read）
    pre_edit_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "read_before_edit_guard.py", "pre"),
        "timeout": 5,
        "statusMessage": "regress-guard: 先读后改检查...",
    }
    post_read_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "read_before_edit_guard.py", "post"),
        "timeout": 5,
        "statusMessage": "regress-guard: 记录读取...",
    }
    events["PreToolUse"] = _drop(events.get("PreToolUse", []), "read_before_edit") + [
        {"matcher": "Edit|Write|ApplyPatch", "hooks": [pre_edit_entry]}]
    events["PostToolUse"] = _drop(events.get("PostToolUse", []), "read_before_edit") + [
        {"matcher": "Read", "hooks": [post_read_entry]}]

    # UserPromptSubmit：需求入口检查（全匹配=省略 matcher；空串违反 schema）
    prompt_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "prompt_intercept.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 需求入口检查...",
    }
    events["UserPromptSubmit"] = _drop(events.get("UserPromptSubmit", []), "prompt_intercept") + [
        {"hooks": [prompt_entry]}]

    # PostToolUseFailure: 失败信号采集
    fail_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "fail_watch.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 失败信号采集...",
    }
    events["PostToolUseFailure"] = _drop(events.get("PostToolUseFailure", []), "fail_watch") + [
        {"matcher": "Bash|Edit|Write", "hooks": [fail_entry]}]

    # PostToolUse: 风险与重复信号采集
    risk_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "risk_watch.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 风险与重复信号采集...",
    }
    events["PostToolUse"] = _drop(events.get("PostToolUse", []), "risk_watch") + [
        {"matcher": "Bash|Edit|Write", "hooks": [risk_entry]}]

    # SessionStart(compact): 压缩记忆降级警告
    compact_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "compact_notice.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 压缩检查...",
    }
    events["SessionStart"] = _drop(events.get("SessionStart", []), "compact_notice") + [
        {"matcher": "compact", "hooks": [compact_entry]}]

    # Stop: 反思检查 + 轮末推送（超时 90s 为自动咨询留余量——正常路径 <1s）
    reflect_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "reflection_check.py"),
        "timeout": 90,
        "statusMessage": "regress-guard: 反思检查...",
    }
    stopn_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "stop_notify.py"),
        "timeout": 8,
        "statusMessage": "regress-guard: 阶段完成推送(授权轮)...",
    }
    # 批135：过滤扩到独立 stop_notify 条目（旧过滤只认 reflection_check，
    # 残留独立 stop_notify 会与 bundled 组双发）
    events["Stop"] = _drop(events.get("Stop", []), "reflection_check", "stop_notify") + [
        {"hooks": [reflect_entry, stopn_entry]}]

    # PreToolUse(Edit|Write|ApplyPatch + Bash): 开发边界守卫
    boundary_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "boundary_guard.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 边界检查...",
    }
    boundary_bash = dict(boundary_entry, statusMessage="regress-guard: 边界检查(Bash)...")
    pt = events["PreToolUse"]
    for e in pt:
        if e.get("matcher") == "Edit|Write|ApplyPatch":
            e["hooks"] = [h for h in e.get("hooks", [])
                          if "boundary_guard" not in json.dumps(h)] + [boundary_entry]
            break
    else:
        pt.append({"matcher": "Edit|Write|ApplyPatch", "hooks": [boundary_entry]})
    for e in pt:  # v1.29 旁路收口：Bash 写目标同样过边界判定
        if e.get("matcher") == "Bash":
            e["hooks"] = [h for h in e.get("hooks", [])
                          if "boundary_guard" not in json.dumps(h)] + [boundary_bash]
            break
    else:
        pt.append({"matcher": "Bash", "hooks": [boundary_bash]})
    events["PreToolUse"] = pt

    # PreToolUse(Bash): 执行阀（公理四——不可逆命令需显式令牌）
    valve_entry = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "execution_valve.py"),
        "timeout": 5,
        "statusMessage": "regress-guard: 执行阀检查...",
    }
    for e in events["PreToolUse"]:
        e["hooks"] = [h for h in e.get("hooks", [])
                      if "execution_valve" not in json.dumps(h)]
    for e in events["PreToolUse"]:
        if e.get("matcher") == "Bash" and e.get("hooks"):
            e["hooks"].append(valve_entry)
            break
    else:
        events["PreToolUse"].append({"matcher": "Bash", "hooks": [valve_entry]})

    # v1.39 原生计划模式桥：ExitPlanMode 批准转录 / 拒绝化石
    bridge_post = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "plan_bridge.py", "post"),
        "timeout": 5,
        "statusMessage": "regress-guard: 原生计划转录...",
    }
    bridge_fail = {
        "type": "command",
        "command": _launcher_cmd(HOOK_HOME, "plan_bridge.py", "fail"),
        "timeout": 5,
        "statusMessage": "regress-guard: 拒绝计划化石...",
    }
    events["PostToolUse"] = _drop(events.get("PostToolUse", []), "plan_bridge") + [
        {"matcher": "ExitPlanMode", "hooks": [bridge_post]}]
    events["PostToolUseFailure"] = _drop(events.get("PostToolUseFailure", []), "plan_bridge") + [
        {"matcher": "ExitPlanMode", "hooks": [bridge_fail]}]

    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    info(f"hook 注册 → {CONFIG_FILE}")


def inject_agents() -> None:
    """注入 AGENTS.md 回归契约 + 灵魂（内容与 install.sh 时代逐字一致）。"""
    SOUL_START = "<!-- regress-guard soul start -->"
    SOUL_END = "<!-- regress-guard soul end -->"
    CONTRACT_START = "<!-- regress-guard start -->"
    CONTRACT_END = "<!-- regress-guard end -->"

    SOUL = f"""{SOUL_START}
## 工作原则

1. **能推断就别问**——代码/日志/上下文里有答案，直接用
2. **有默认就别选**——给用户"否决权"而非"选择题"
3. **做完了汇报**——别中途请示，做完说结果
4. **自己犯的错自己修**——测试失败自己改，别甩给用户
5. **只问改变交付性质的事**——"做什么"问人，"怎么做"自己定
{SOUL_END}"""

    # 契约长度冻结（v1.20 决策）：13 条封顶——每加一条必须并掉一条；长契约会被摘要，被摘要的规则等于没写
    CONTRACT = f"""{CONTRACT_START}
## 回归契约

0. **先读后改**：改代码前至少读 2 个相关文件（hook 强制；读后被外部改过的文件指纹不匹配，hook 会拦）
1. **需求解析优先**：从代码推断上下文、检测歧义、自决消歧；计划（planning 状态）须人类批准后才实施——批准前边界守卫拦编辑，不认同就继续对话完善；批准走 lib/plan_approve.py（approved 落产物+漂移检查），人类也可直接填清单 approved.at（产物直通）；**原生计划模式批准由 plan_bridge 钩子自动转录（钩子未生效时 AI 补转录，幂等）**；断点续作用 /regress-resume 从产物层重建现场
2. 开发完跑 /regress-track 发现 F3，直接回写
3. 提交时 hook 自跑测试，被拦后自己修；**脆弱点 open 状态的清单禁止提交**（先 verify 拿证据转 locked，或显式 flagged 挂牌）
4. 紧急用 /regress-bypass <分钟> 临时绕过
5. 改 >=3 个文件时 hook 会触发 pre-mortem：假设出bug最可能是什么？
6. **不可逆命令要令牌**：mkfs/dd if=/force push/DROP/TRUNCATE/项目外 rm -rf 会被执行阀拦，确要执行须显式加 REGRESS_CONFIRM=YES 前缀（禁止习惯性携带）
7. **失败/风险/用户纠正自动入地层**（.regress/journal/，append-only）——别删，那是未来会话的考古资产；重大决策（含否决过的方案）写 .regress/decisions.md
8. **开发边界**：活跃清单外/边界外的文件 Edit/Write 会被 hook **事前拦截**——别绕，扩界的唯一出口是 /regress-track 回写（留痕）；边界不是拖慢，是把 token 和质量都省下来（6B→1B 实证）
9. **受阻是一等状态**：卡住别硬磨别绕过——`plan_approve.py <清单> --block --reason --need` 四问落产物并转达人类（受阻期间边界守卫拦编辑）；解阻后 `--unblock`
10. **假设被证伪别悄悄改**：verify 实测推翻清单推测时，追加「假设失效记录」（was→reality→evidence）+ `journal.py . add assumption_broken`——失效过程比结论值钱
11. **顾问预审（伪全自动）**：计划卡片送顾问预审——顾问有一票否决权（有方向性异议必等人，即使已预授权）无一票批准权；预授权任务无异议才 `--provisional --advisor` 临行（否决窗内 `--cancel` 可停）；知识型受阻先问顾问再 --block；预审意见必须来自真实 consult（audit 可查），不得代笔
12. **验证主权（AVS）**：测试替身的宽松断言（oracle：模拟器不校验什么/mock 不查什么）入脆弱点拓扑单列——单测假阴性之源；感官终验问人只收通过/不通过并落 human_check 化石（verify=human_check:<vid>，门禁验化石存在性不复跑感官）；环境脆弱点落启动预检（含跨服务契约往返断言），禁止"请确保 Redis 已启动"式人读指令；真机联调自主完成，仅感官终验时叫人（"你自己弄！成功后再叫人类！"）

脚本路径（命令文档中 `<插件路径>` 的解析）：lib 脚本一律用已安装路径
`~/.zcode/regress-guard-hooks/lib/`（journal.py / plan_approve.py / history.py 都在），
`<插件路径>/hooks/scripts/lib/` 是源码等价路径。

可用命令：/regress-init, /regress-plan, /regress-track, /regress-verify,
/regress-quick, /regress-bypass, /regress-learn, /regress-evolve,
/regress-trace, /regress-resume, /regress-finish,
/regress-install, /regress-uninstall, /regress-update
{CONTRACT_END}"""

    FULL_BLOCK = SOUL + "\n\n" + CONTRACT

    content = ""
    if os.path.exists(AGENTS_FILE):
        with open(AGENTS_FILE, encoding="utf-8") as f:
            content = f.read()
        # 先清理旧版标记块（兼容升级）
        for marker_s, marker_e in [(SOUL_START, SOUL_END), (CONTRACT_START, CONTRACT_END)]:
            pattern = re.escape(marker_s) + r".*?" + re.escape(marker_e) + r"\n*"
            content = re.sub(pattern, "", content, flags=re.DOTALL)
        new = content.rstrip() + "\n\n" + FULL_BLOCK + "\n"
    else:
        new = "# 用户级指令\n\n" + FULL_BLOCK + "\n"

    with open(AGENTS_FILE, "w", encoding="utf-8") as f:
        f.write(new)
    info("AGENTS.md 已注入（含灵魂原则）")


def copy_docs() -> None:
    docs_dst = os.path.join(ZCODE_HOME, "regress-guard-docs")
    os.makedirs(docs_dst, exist_ok=True)
    for src, name in [
        (os.path.join(PLUGIN_ROOT, "scripts", "check_docs.py"), "check_docs.py"),
        (os.path.join(PLUGIN_ROOT, "docs", "小白指南.md"), "小白指南.md"),
        (os.path.join(PLUGIN_ROOT, "docs", "WORKFLOW.md"), "WORKFLOW.md"),
    ]:
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(docs_dst, name))


def write_source_stamp() -> str:
    version = "unknown"
    try:
        with open(os.path.join(PLUGIN_ROOT, ".zcode-plugin", "plugin.json"),
                  encoding="utf-8") as f:
            version = json.load(f).get("version", "unknown")
    except Exception:
        pass
    with open(os.path.join(HOOK_HOME, ".source"), "w", encoding="utf-8") as f:
        f.write(f"source_path={PLUGIN_ROOT}\n"
                f"source_version={version}\n"
                f"installed_at={datetime.now().isoformat()}\n")
    info(f"版本标记: v{version}（源: {PLUGIN_ROOT}）")
    return version


def post_check() -> None:
    """v1.76 安装后自检：红即大声失败（装坏当场知）。

    批191 顺手修正：install.sh 时代硬编码 ${HOME}/.zcode/...，沙箱覆写
    REGRESS_ZCODE_HOME 时自检查的是真机路径——现统一走 HOOK_HOME。"""
    print()
    r = subprocess.run(
        [sys.executable, os.path.join(PLUGIN_ROOT, "scripts", "post_install_check.py"),
         PLUGIN_ROOT, HOOK_HOME],
        env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if r.returncode != 0:
        print()
        error("安装后自检未过——按上方指引修复后再使用")
        sys.exit(1)


def main() -> None:
    print("════════════════════════════════════════════")
    print("  regress-guard 一键安装")
    print("════════════════════════════════════════════")
    print()
    preflight()
    print(f"插件源: {PLUGIN_ROOT}")
    print(f"目标:   {ZCODE_HOME}")
    print()
    copy_files()
    register_hooks()
    inject_agents()
    copy_docs()
    write_source_stamp()
    post_check()
    print()
    print("════════════════════════════════════════════")
    print("  ✅ regress-guard 安装完成！")
    print("════════════════════════════════════════════")
    print()
    print("已安装：")
    print("  • 全部 /regress-* 命令（以 ~/.zcode/commands/ 实际装入为准——数字宣称会腐烂，126 起由 test_claims_lint 对账）")
    print("  • commit 卡点 hook（自动跑测试）")
    print("  • 先读后改门禁 + 文件指纹（读后被外部改过 → 强制重读）")
    print("  • pre-mortem 反思（改≥3文件时触发）")
    print("  • SessionStart 自愈（自动修复缺失文件）")
    print("  • 全自动无感层：失败风暴→scout / 破坏性动作未过审→补审 / 打转检测 / 方向漂移（清单外改动）")
    print("  • SessionStart(compact) 压缩记忆降级警告")
    print("  • 四公理机制：")
    print("      公理一 脆弱点挂牌（fragile_points open 禁提交，verify 拿证据转 locked）")
    print("      公理二 认知物质化（决策日志 decisions.md + 文件指纹校验）")
    print("      公理三 考古地层（journal/events.jsonl，失败/风险/纠正化石随 git 入库）")
    print("      公理四 执行阀（不可逆命令需显式令牌 REGRESS_CONFIRM=YES）")
    print("  • 开发边界守卫（越界编辑事前拦截，track 回写即扩界——6B→1B 的关键机制）")
    print("  • AGENTS.md 回归契约")
    print()
    print("现在在任意项目中对 AI 说：")
    print("  /regress-init    ← 初始化项目")
    print()
    print(f"卸载：python {os.path.join(PLUGIN_ROOT, 'uninstall.py')}")


if __name__ == "__main__":
    main()
