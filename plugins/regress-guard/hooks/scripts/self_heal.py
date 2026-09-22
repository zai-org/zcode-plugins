#!/usr/bin/env python3
"""SessionStart 自愈脚本——每次 ZCode 启动时检查 regress-guard 文件完整性。

检查项：
  1. ~/.zcode/regress-guard-hooks/launcher.js 是否存在
  2. ~/.zcode/regress-guard-hooks/pre_commit_guard.py 是否存在
  3. ~/.zcode/regress-guard-hooks/lib/*.py 是否完整
  4. ~/.zcode/skills/ 下的 3 个 skill 是否存在
  5. config.json 中 hook 是否注册

如果发现缺失，尝试从源目录自动修复。
如果有字段缺失但无法修复，输出警告（通过 additionalContext 注入对话）。

被 SessionStart hook 调用，输出 JSON 到 stdout。
"""
import sys
import os
import re
import json
import glob


def _ver_gt(a, b):
    """比较语义版本 a > b（如 '0.6.0' > '0.5.0'）。"""
    def parse(v):
        try:
            return tuple(int(x) for x in v.split("."))
        except (ValueError, AttributeError):
            return (0, 0, 0)
    return parse(a) > parse(b)


ZCODE_HOME = os.path.expanduser("~/.zcode")
HOOK_HOME = os.path.join(ZCODE_HOME, "regress-guard-hooks")
SKILLS_DIR = os.path.join(ZCODE_HOME, "skills")
COMMANDS_DIR = os.path.join(ZCODE_HOME, "commands")
CONFIG_FILE = os.path.join(ZCODE_HOME, "cli", "config.json")

# 源目录（尝试多个位置）
SOURCE_CANDIDATES = [
    os.path.join(ZCODE_HOME, "workspace", "default", "regress-guard"),
    os.path.join(os.getcwd(), "regress-guard"),
    # 从 hook 脚本自身位置反推（hook 脚本在 regress-guard/hooks/scripts/lib/ 下）
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    # 常见开发路径
    os.path.join(os.path.expanduser("~"), "regress-guard"),
    os.path.join(os.path.expanduser("~"), "projects", "regress-guard"),
]

# 完整契约清单（v1.26.1 补全；与源目录的漂移由 check_docs 守卫拦——病例：本次审计发现
# 清单停在 v1.19，boundary_guard 等 5 脚本与 4 个 lib 不在清单，do_upgrade 半量拷贝）
REQUIRED_HOOK_FILES = ["launcher.js", "pre_commit_guard.py", "read_before_edit_guard.py",
                       "prompt_intercept.py", "reflection_check.py", "fail_watch.py",
                       "risk_watch.py", "compact_notice.py", "execution_valve.py",
                       "boundary_guard.py", "stop_notify.py", "plan_bridge.py"]
REQUIRED_LIB_FILES = [
    "manifest_parser.py", "git_diff_analyzer.py",
    "test_runner.py", "history.py", "filelock.py", "self_heal.py",
    "cochange_rules.py",
    "journal.py", "plan_approve.py", "manifest_fields.py", "rules_ledger.py",
    "notify.py", "wecom_notify.py", "facts.py",
    "pending.py", "session_relay.py", "sentinel.py", "scan_check.py",
    "secret_scan.py", "test_cache.py"
]
REQUIRED_COMMANDS = [
    "regress:init", "regress:plan", "regress:track", "regress:verify",
    "regress:quick", "regress:bypass", "regress:learn", "regress:evolve",
    "regress:trace", "regress:resume", "regress:finish", "regress:stats",
    "regress:characterize",
    "regress:install", "regress:uninstall", "regress:update"
]

README_TEMPLATE_NAME = "regress-dir-readme.md"


def find_source():
    """找到插件源目录。"""
    for path in SOURCE_CANDIDATES:
        if os.path.isfile(os.path.join(path, "install.sh")):
            return os.path.abspath(path)
    return None


def get_installed_version():
    """读取已安装版本号。"""
    meta_path = os.path.join(HOOK_HOME, ".source")
    if os.path.exists(meta_path):
        try:
            with open(meta_path) as f:
                for line in f:
                    if line.startswith("source_version="):
                        return line.strip().split("=", 1)[1]
        except (IOError, OSError):
            pass
    return "0.0.0"


def get_source_version(source):
    """读取源目录版本号。"""
    pj = os.path.join(source, ".zcode-plugin", "plugin.json")
    try:
        with open(pj) as f:
            import json
            return json.load(f).get("version", "0.0.0")
    except (IOError, json.JSONDecodeError):
        return "0.0.0"


def do_upgrade(source):
    """从源目录全量覆盖升级（commands/hooks/lib/scripts）。"""
    import shutil
    upgraded = []

    # 清理旧版 skills（v1.1 砍掉了 skills 目录）
    skills_dir_source = os.path.join(source, "skills")
    if not os.path.isdir(skills_dir_source):
        # 源已无 skills → 清理安装目录的旧 skills
        if os.path.isdir(SKILLS_DIR):
            for old_skill in ("regression-planning", "characterization-testing",
                              "change-impact-analysis", "requirement-parsing",
                              "adaptive-thinking", "adaptive-learning"):
                old_path = os.path.join(SKILLS_DIR, old_skill)
                if os.path.isdir(old_path):
                    shutil.rmtree(old_path, ignore_errors=True)
                    upgraded.append(f"清理旧skill:{old_skill}")

    # 清理旧版 evolution.py（v1.1 砍掉了）
    old_evolution = os.path.join(HOOK_HOME, "lib", "evolution.py")
    if os.path.exists(old_evolution) and not os.path.exists(os.path.join(source, "hooks", "scripts", "lib", "evolution.py")):
        os.remove(old_evolution)
        upgraded.append("清理旧lib:evolution.py")

    # commands
    for cmd_file in os.listdir(os.path.join(source, "commands")):
        if cmd_file.endswith(".md"):
            shutil.copy2(os.path.join(source, "commands", cmd_file), COMMANDS_DIR)
            upgraded.append(f"cmd:{cmd_file}")

    # hook scripts + lib：全量拷贝（v1.26.1——目录本身是单一来源，清单只做缺失检测；
    # 旧实现按过时清单半量拷贝，升级机拿到陈旧 boundary_guard/缺失 rules_ledger）
    # P2#23：原子替换（copy→tmp+os.replace）——就地截断写在升级窗口内可能让
    # 新起的钩子进程读到半截源码 SyntaxError→门禁崩溃即放行
    def _atomic_copy(src, dst):
        tmp = dst + ".heal.tmp"
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)

    scripts_dir = os.path.join(source, "hooks", "scripts")
    for f in sorted(os.listdir(scripts_dir)):
        if f.endswith((".py", ".js")) and f != "self_heal.py":
            _atomic_copy(os.path.join(scripts_dir, f), os.path.join(HOOK_HOME, f))
            upgraded.append(f"hook:{f}")
    lib_dir = os.path.join(scripts_dir, "lib")
    for f in sorted(os.listdir(lib_dir)):
        if f.endswith(".py"):
            _atomic_copy(os.path.join(lib_dir, f), os.path.join(HOOK_HOME, "lib", f))
            upgraded.append(f"lib:{f}")

    # templates：全部部署（init 的 cp 引用 <插件路径>/templates/，缺文件即断链）
    tpl_src = os.path.join(source, "templates")
    tpl_dst = os.path.join(HOOK_HOME, "templates")
    os.makedirs(tpl_dst, exist_ok=True)
    for f in sorted(os.listdir(tpl_src)):
        if f.endswith(".md"):
            shutil.copy2(os.path.join(tpl_src, f), os.path.join(tpl_dst, f))
            upgraded.append(f"tpl:{f}")

    # self_heal 本身
    src = os.path.join(source, "hooks", "scripts", "self_heal.py")
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(HOOK_HOME, "lib", "self_heal.py"))

    # 更新版本标记
    meta_path = os.path.join(HOOK_HOME, ".source")
    with open(meta_path, "w") as f:
        f.write(f"source_path={source}\n")
        f.write(f"source_version={get_source_version(source)}\n")
        import datetime
        f.write(f"upgraded_at={datetime.datetime.now().isoformat()}\n")

    return upgraded


def _current_regress_dir():
    """定位当前项目的 .regress/（向上最多 10 级）。"""
    d = (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    d = os.path.abspath(d)
    for _ in range(10):
        cand = os.path.join(d, ".regress")
        if os.path.isdir(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent
    return None


def find_readme_template():
    """零号入口模板：安装目录 templates/ 或源目录 templates/。"""
    cands = [os.path.join(HOOK_HOME, "templates", README_TEMPLATE_NAME)]
    src = find_source()
    if src:
        cands.append(os.path.join(src, "templates", README_TEMPLATE_NAME))
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


_README_MARKER = re.compile(r"generated-by:\s*regress-guard\s*v(\d[\d.]*)")


def _tpl_version(tpl_path):
    try:
        with open(tpl_path, encoding="utf-8") as f:
            m = _README_MARKER.search(f.read())
        return m.group(1) if m else ""
    except (IOError, OSError):
        return ""


def backfill_project_readme(regress_dir):
    """老项目自动升级（v1.16 补 / v1.21 刷新）：.regress/ 的零号 README。

    三分法：缺失→补；带 generated-by 标记且版本旧→刷新（机器写的，安全）；
    无标记（人类定制）或版本不旧→**永不动**。
    """
    readme = os.path.join(regress_dir, "README.md")
    tpl = find_readme_template()
    if not tpl:
        return None
    if not os.path.exists(readme):
        import shutil
        shutil.copy2(tpl, readme)
        return f"老项目升级·补零号入口: {readme}"
    try:
        with open(readme, encoding="utf-8") as f:
            existing = f.read()
    except (IOError, OSError):
        return None
    m = _README_MARKER.search(existing)
    if not m:
        return None  # 人类定制（或无标记）——永不覆盖
    tpl_ver = _tpl_version(tpl)
    if tpl_ver and _ver_gt(tpl_ver, m.group(1)):
        import shutil
        shutil.copy2(tpl, readme)
        return f"老项目升级·刷新机器生成的 README v{m.group(1)}→v{tpl_ver}: {readme}"
    return None


def _active_manifest_sentinel():
    """活跃清单哨兵（v1.17）：新会话第一眼知道有任务在进行、续作走哪条路。

    失忆读者层的命令召唤侧——产物层建了自足性，还得有人在会话开场指路。
    SessionStart(startup) 每会话只发一次，无需防重复门。
    字段读取统一走 lib/manifest_fields（v1.20 单一来源）。
    """
    regress_dir = _current_regress_dir()
    if not regress_dir:
        return None
    base = os.path.dirname(os.path.abspath(__file__))
    for p in (base, os.path.join(base, "lib")):
        if p not in sys.path:
            sys.path.insert(0, p)
    from manifest_fields import parse_core, ACTIVE_STATUSES, field
    from manifest_parser import read_frontmatter

    def _stale_suffix(mf, content, status):
        """长寿可见化（v1.23.2）：planning/verifying 搁置 >30 天标 ⏰。

        遗忘的清单不会过期（设计如此——清单是人类的决策物），但僵尸的默认
        状态不该是"神秘禁编"，该是"一眼可见"。只提示，不自动处置。
        年龄信号：created_at 优先；缺失/不可解析则 mtime 兜底
        （真实项目实证：旧模板清单普遍无 created_at，如 lqgd 全部 5 个）。
        """
        if status not in ("planning", "verifying"):
            return ""
        days = None
        created = (field(content, "created_at") or "")[:10]
        if created:
            try:
                from datetime import date
                days = (date.today() - date.fromisoformat(created)).days
            except ValueError:
                days = None
        if days is None:
            try:
                import time as _time
                days = int((_time.time() - os.path.getmtime(mf)) // 86400)
            except (OSError, ValueError):
                return ""
        return f" · ⏰ 已搁置{days}天" if days > 30 else ""

    lines = []
    mdir = os.path.join(regress_dir, "manifests")
    if not os.path.isdir(mdir):
        return None
    import glob as _glob
    for mf in sorted(_glob.glob(os.path.join(mdir, "*.md")), reverse=True):
        try:
            content = read_frontmatter(mf)
        except (IOError, OSError):
            continue
        core = parse_core(content)
        status = core.get("status", "")
        if status not in ACTIVE_STATUSES:
            continue
        name = core.get("id") or os.path.basename(mf)
        if status == "blocked":
            need = core.get("blocked_need", "") or "见 blocked 块"
            lines.append(f"🛑 {name}（blocked · 受阻，需要人类：{need[:40]}）")
        elif status == "in-progress" and core.get("provisional_at"):
            # 临行（伪全自动）：否决窗内——执行授权来自人类事前预授权，此刻仍可 --cancel
            lines.append(f"🚀 {name}（临行中 · 顾问预审通过 · 否决窗内，--cancel 可停）")
        else:
            extra = {"planning": "待人类批准",
                     "verifying": "验证中"}.get(status, f"{core.get('open_fragiles', 0)} 个脆弱点未锁")
            icon = {"planning": "⏸", "in-progress": "🎯", "verifying": "🔍"}[status]
            lines.append(f"{icon} {name}（{status} · {extra}{_stale_suffix(mf, content, status)}）")
        if len(lines) >= 3:
            break
    if not lines:
        return None
    return ("【进行中任务】\n" + "\n".join(lines)
            + "\n断点续作：/regress:resume（从 .regress/ 产物层单侧重建现场）")


def backfill_lock_gitignore(regress_dir):
    """长寿（v1.23.3）：manifests/.gitignore 缺失即补（幂等，永不覆盖已有内容）。

    病例：windwos 项目 4 个 .lock 残留——filelock 的 sidecar 空文件无害，
    但下次 git add .regress 就会进仓库。写在 manifests/ 内部，不碰用户的 .gitignore。
    """
    gi = os.path.join(regress_dir, "manifests", ".gitignore")
    if not os.path.isdir(os.path.dirname(gi)) or os.path.exists(gi):
        return None
    try:
        with open(gi, "w", encoding="utf-8") as f:
            f.write(".*.lock\n")
        return "manifests/.gitignore（锁残留不入库）"
    except (IOError, OSError):
        return None


def check_and_heal():
    """检查文件完整性 + 版本升级。返回 (issues, healed)。"""
    issues = []
    healed = []
    source = find_source()

    # ─── 0. 版本检测：源版本更高则自动升级 ───────────
    if source:
        installed_ver = get_installed_version()
        source_ver = get_source_version(source)
        if _ver_gt(source_ver, installed_ver):
            upgraded = do_upgrade(source)
            healed.append(f"自动升级 v{installed_ver} → v{source_ver}（{len(upgraded)} 个文件）")
            # 升级后不需要再检查文件完整性（刚全量覆盖）
            return issues, healed

    # ─── 1. hook 脚本 ─────────────────────────────────

    # ─── 1. hook 脚本 ─────────────────────────────────
    for f in REQUIRED_HOOK_FILES:
        path = os.path.join(HOOK_HOME, f)
        if not os.path.exists(path):
            if source:
                src = os.path.join(source, "hooks", "scripts", f)
                if os.path.exists(src):
                    os.makedirs(HOOK_HOME, exist_ok=True)
                    import shutil
                    shutil.copy2(src, path)
                    healed.append(f"恢复 hook: {f}")
                else:
                    issues.append(f"hook 脚本缺失且无法恢复: {f}")
            else:
                issues.append(f"hook 脚本缺失: {f}")

    # ─── 2. lib 文件 ──────────────────────────────────
    lib_dir = os.path.join(HOOK_HOME, "lib")
    for f in REQUIRED_LIB_FILES:
        path = os.path.join(lib_dir, f)
        if not os.path.exists(path):
            if source:
                src = os.path.join(source, "hooks", "scripts", "lib", f)
                if os.path.exists(src):
                    os.makedirs(lib_dir, exist_ok=True)
                    import shutil
                    shutil.copy2(src, path)
                    healed.append(f"恢复 lib: {f}")
                else:
                    issues.append(f"lib 缺失且无法恢复: {f}")
            else:
                issues.append(f"lib 缺失: {f}")

    # ─── 3. commands ──────────────────────────────────
    for cmd in REQUIRED_COMMANDS:
        cmd_path = os.path.join(COMMANDS_DIR, f"{cmd}.md")
        if not os.path.exists(cmd_path):
            if source:
                src = os.path.join(source, "commands", f"{cmd}.md")
                if os.path.exists(src):
                    os.makedirs(COMMANDS_DIR, exist_ok=True)
                    import shutil
                    shutil.copy2(src, cmd_path)
                    healed.append(f"恢复命令: {cmd}")
                else:
                    issues.append(f"命令缺失且无法恢复: {cmd}")
            else:
                issues.append(f"命令缺失: {cmd}")

    return issues, healed


def _gc_tmp_state(max_age_days=7):
    """P2#27：/tmp 状态文件 GC——评审实测 5 天积 238 个（last-prompt×80+、
    stop-notify 戳×58、read-counter 等）。死会话的状态文件永不清理。
    SessionStart 顺手扫，>7 天即删；失败静默（GC 是卫生不是依赖）。"""
    import tempfile, time, glob as _g
    try:
        cutoff = time.time() - max_age_days * 86400
        base = tempfile.gettempdir()
        n = 0
        for p in _g.glob(os.path.join(base, "regress-guard-*")):
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
                    n += 1
            except OSError:
                pass
        if n:
            return f"gc:{n}"
    except Exception:
        pass
    return None


def check_bridge_registration():
    """v1.39 注册漂移警示（REGRESS-2026-028）：plan_bridge.py 文件在而
    config.json 无桥注册——自愈只搬脚本不改编用户配置（红线），漂移只警示，
    修复出口是重跑 install.sh。警示走 stderr（ZCode log 可见），不打断启动。"""
    try:
        if not os.path.exists(os.path.join(HOOK_HOME, "plan_bridge.py")):
            return
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        blob = json.dumps(cfg.get("hooks", {}).get("events", {}))
        if "plan_bridge" not in blob:
            print("REGRESS-GUARD: ⚠️ 计划桥脚本已就位但 config.json 未注册——"
                  "重跑 install.sh 激活原生计划模式转录", file=sys.stderr)
    except Exception:
        pass  # 警示是增强不是依赖


def _drift_pair():
    """(已装, 源仓) 版本对；任一缺失返回 None。v1.78 拆出供 Stop 级警示复用。"""
    try:
        installed = ""
        src_meta = os.path.join(HOOK_HOME, ".source")
        if os.path.isfile(src_meta):
            with open(src_meta, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("source_version="):
                        installed = line.split("=", 1)[1].strip()
        if not installed:
            return None
        for cand in SOURCE_CANDIDATES:
            pj = os.path.join(cand, ".zcode-plugin", "plugin.json")
            if os.path.isfile(pj):
                with open(pj, encoding="utf-8") as f:
                    source_v = str(json.load(f).get("version") or "")
                if source_v:
                    return (installed, source_v)
    except Exception:
        pass
    return None


def _ver_key(v):
    """semver 规范化比较键（顾问精化③）：x.y.z 取整数元组，非数字段原样垫后。"""
    body = str(v).lstrip("v").split("+")[0]
    parts = body.split(".")
    key = []
    for p in parts[:3]:
        key.append(int(p) if p.isdigit() else 0)
    while len(key) < 3:
        key.append(0)
    key.append("-".join(parts[3:]) or ("-" in parts[-1] and not parts[-1].isdigit() and parts[-1] or ""))
    return tuple(key)


def check_version_drift():
    """v1.59 版本漂移警示（044 病例机制化）：源仓 plugin.json 新于已装副本
    → 会话启动自愈本会同步，但热会话里的钩子仍是旧版在把关——警示一眼可见。
    已装版本读 install.sh 落的 .source 戳（source_version= 行）。
    只警示不自动改（升级走既有轨道：会话启动自愈 / install.sh）。"""
    pair = _drift_pair()
    if not pair:
        return
    installed, source_v = pair
    if _ver_key(source_v) != _ver_key(installed):
        print(f"REGRESS-GUARD: ⚠️ 已装副本 v{installed} 与源仓 v{source_v} "
              f"版本漂移——重启会话（启动自愈会同步）或重跑 install.sh 激活，"
              f"期间钩子按旧版把关（事件已盖 guard_version 可查）",
              file=sys.stderr)


def main():
    # 快速检查：如果连 hook_home 都不存在，说明根本没装过，跳过
    if not os.path.isdir(HOOK_HOME):
        # 未安装状态，不干预
        print(json.dumps({"status": "not_installed"}))
        return

    issues, healed = check_and_heal()
    gc_note = _gc_tmp_state()
    if gc_note:
        healed.append(gc_note)
    check_bridge_registration()
    check_version_drift()

    # 老项目自动升级：零号入口缺失即补（幂等，永不覆盖已定制内容）
    rg = _current_regress_dir()
    if rg:
        note = backfill_project_readme(rg)
        if note:
            healed.append(note)
        note = backfill_lock_gitignore(rg)
        if note:
            healed.append(note)

    # 项目经验注入（越用越聪明的 ambient 层）：摘要有变化才注入，避免每次启动刷屏
    # 活跃清单哨兵：有任务在进行则必注入（每会话一次，指路 /regress:resume）
    sentinel = _active_manifest_sentinel()
    digest = _project_digest()
    context = "\n\n".join(p for p in (sentinel, digest) if p)
    if healed:
        msg = "regress-guard 自愈：恢复了 " + ", ".join(healed)
        if context:
            msg += "\n\n" + context
        print(json.dumps({"status": "healed", "additionalContext": msg}))
    elif issues:
        msg = "regress-guard 警告：以下文件缺失且无法自动恢复：\n" + "\n".join(f"  - {i}" for i in issues)
        msg += "\n\n建议重新运行 /regress:install"
        print(json.dumps({"status": "warning", "additionalContext": msg}))
    elif context:
        # 哨兵（有活跃任务时）或摘要变化时注入
        print(json.dumps({"status": "ok", "additionalContext": context}))
    else:
        print(json.dumps({"status": "ok"}))


def _project_digest(max_lines=5):
    """从当前项目的 .regress 生成经验摘要；无有效数据或未变化时返回 None。

    防重复门：摘要 hash 存 .regress/.last-digest，相同则不注入。
    """
    import hashlib
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        for p in (base, os.path.join(base, "lib")):
            if p not in sys.path:
                sys.path.insert(0, p)
        from history import summarize
    except ImportError:
        return None

    # 定位当前项目的 .regress
    regress_dir = _current_regress_dir()
    if not regress_dir:
        return None

    try:
        s = summarize(regress_dir)
    except Exception:
        return None

    lines = []
    f3s = s.get("top_f3_files") or []
    if f3s:
        files = ", ".join(f"{f}({c})" for f, c in f3s[:2])
        lines.append(f"📋 本项目规律：改这些文件时容易漏改 {files}")
    debt = s.get("tech_debt", 0)
    if debt > 0:
        lines.append(f"💳 有 {debt} 笔 bypass 未补回归")
    cov = s.get("avg_coverage_pct")
    if cov is not None:
        lines.append(f"📊 平均测试覆盖率 {cov}%")
    outs = s.get("outside_gate_commits", 0)
    if outs > 0:
        lines.append(f"📤 {outs} 次提交未走门禁（IDE/终端直提）")
    if not lines:
        return None

    digest = "【regress-guard 项目经验】\n" + "\n".join(lines[:max_lines])
    marker = os.path.join(regress_dir, ".last-digest")
    h = hashlib.md5(digest.encode()).hexdigest()[:10]
    prev = ""
    try:
        prev = open(marker).read().strip()
    except (IOError, OSError):
        pass
    if prev == h:
        return None  # 摘要未变化，不重复注入
    try:
        open(marker, "w").write(h)
    except (IOError, OSError):
        pass
    return digest


if __name__ == "__main__":
    main()
