#!/usr/bin/env python3
"""pre_commit_guard.py — regress-guard PreToolUse hook（跨平台纯 Python 版）。

取代 pre_commit_guard.sh。用 type:"process" 的 hook 直接调用，无需 shell。

校验顺序（短路）：
  1. stdin 解析：是否 git commit？否则 exit 0
  2. 有 .regress/？否则 exit 0
  3. bypass 有效？记日志 + exit 0
  4. 活跃清单按会话归属选择（v1.34）：mine=无戳或戳==本会话（hook env）；
     env 缺失时全部视为 mine（fail-safe 老行为）。他人清单只在本提交
     staged 撞其清单文件时拦（跨会话冲突=集成态检查），否则放行+警示——
     治 2026-09-07 标本1（被他人 in-progress 清单挡住干等）
  5. staged 文件都在清单内？否则 exit 2
  6. 自己跑测试：pass→exit0+标done / fail→exit2 / skip→降级检查status
     （5.5 V门禁：open 禁提交；5.6 证据律：locked 门禁复验 verify 命令，
       human_check: 前缀验化石存在性不复跑感官）

退出码：0=放行，2=阻断
"""
import sys
import os
import re
import json
import getpass
import subprocess
import traceback
from datetime import datetime

# ─── 定位 lib 目录（兼容被 process hook 调用时的各种 CWD）─────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(SCRIPT_DIR, "lib")
if LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)

from manifest_parser import find_active_manifest, get_all_changed_files, get_manifest_status, update_frontmatter, get_fragile_points, parse_frontmatter  # noqa: E402
from git_diff_analyzer import get_staged_files, filter_files, find_untracked_changes  # noqa: E402
from test_runner import run_tests  # noqa: E402
from history import record as _history_record  # noqa: E402


def _running_version():
    """门禁自身版本（v1.59）：044 病例——活体门禁是旧已装副本时无从查证。

    源仓布局读 plugin.json（本文件在 hooks/scripts/ 下，上三级即插件根）；
    已装布局无 plugin.json → 读 install.sh 落的 .source 戳（source_version=）。
    """
    try:
        pj = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__)))), ".zcode-plugin", "plugin.json")
        with open(pj, encoding="utf-8") as f:
            return str(json.load(f).get("version") or "unknown")
    except Exception:
        pass
    try:
        meta = os.path.join(os.path.expanduser("~/.zcode"),
                            "regress-guard-hooks", ".source")
        with open(meta, encoding="utf-8") as f:
            for line in f:
                if line.startswith("source_version="):
                    return line.split("=", 1)[1].strip() or "unknown"
    except Exception:
        pass
    return "unknown"


def record(rd, event, manifest_id="", **details):
    """一点包装（v1.59）：所有事件盖 guard_version——谁在把关，事后可查。"""
    details.setdefault("guard_version", _running_version())
    _history_record(rd, event, manifest_id, **details)


def emit_pass():
    sys.exit(0)

# blocked 推送的上下文（P1#5）：main 定位项目/清单后回填——record 只留本机痕，
# 手机才是人所在的屏。评审病例：history 6 个 blocked 事件期间 wecom 台账 0 条
_NOTIFY_STATE = {"project_dir": None, "manifest_id": ""}

# 拦截现场召回（v1.54）：拦截给"新问题的新信息"，召回附"老问题的老答案"。
# 只接高频3点——stderr 越长越被忽略（顾问），扩展留给字段数据说话
_RECALL_REASONS = ("test_failed", "fragile_verify_failed", "scan_missing")


def _recall_hint(reason_key, msg):
    """召回段（v1.54 稠密反馈：骨架库从写多读少接到失败现场）。

    只进 stderr（Agent 必读），不进手机推送（首行是给人的摘要）；
    RG_RECALL=off 一键关；任何异常静默降级——召回是增强不是依赖。
    开火记 rule_recall 事件（量测位：先计数，有没有用等字段说话）。
    """
    if reason_key not in _RECALL_REASONS or os.environ.get("RG_RECALL") == "off":
        return ""
    pd = _NOTIFY_STATE.get("project_dir")
    if not pd:
        return ""
    try:
        from rules_ledger import match
        res = match(pd, f"{reason_key} {msg[:300]}", top=3)
        if not res:
            return ""
        try:
            record(os.path.join(pd, ".regress"), "rule_recall",
                   _NOTIFY_STATE.get("manifest_id") or "?",
                   reason=reason_key, n=len(res),
                   sigs=[r["sig"][:60] for r in res])
        except Exception:
            pass
        lines = ["\n📚 相关历史规律（骨架库召回——提示不是行动，采纳前对照本次现场）："]
        lines += [f"  {i}. 「{r['sig'][:70]}」 命中×{r['hits']}（最近 {r['last_hit']}）"
                  for i, r in enumerate(res, 1)]
        return "\n".join(lines)
    except Exception:
        return ""


# 验收行"已勾"标记（v1.55 验收入环）：
#   EARS 列表行 → 行尾标记（✅/已验/（过）/通过），行内散文不误判；
#   表格行 → 状态列（末列）行尾标记或含 pass/done/ok/locked/✔（短单元格低散文风险）
_ACC_END_MARKS = ("✅", "已验", "（过）", "通过")
_ACC_CELL_KEYWORDS = ("pass", "done", "ok", "locked", "✔")


def _acceptance_state(manifest_path):
    """解析验收标准节（v1.55）：返回 (present, total, open_rows)。

    present=False = 无「## 验收标准」节；total = 认出的判据行数（0=节在但没写判据）；
    open_rows = 未勾判据行的短描述。判据行两种形态：EARS 列表行（单行
    "- When…则…（验：…）" 或两行判据+缩进（验：…）续行——先合并成逻辑行再判）
    与表格行。无（验： 的 EARS 行 = 不完整判据（v1.40 三件齐才算一条）= 未勾；
    {{占位}} 行 = 没写 = 未勾；✅ 标记放逻辑行最尾（验命令之后）。
    解析永不抛错（读不到=不在此处拦）。
    """
    try:
        text = open(manifest_path, encoding="utf-8").read()
    except Exception:
        return True, 1, []
    m = re.search(r"^## 验收标准.*?(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return False, 0, []
    # 逻辑行合并：列表项的缩进续行拼回同一条判据
    logical, rows = [], []
    for line in m.group(0).splitlines():
        s = line.strip()
        if s.startswith("|"):
            if logical:
                rows.append(" ".join(logical))
                logical = []
            rows.append(s)
        elif s.startswith("- "):
            if logical:
                rows.append(" ".join(logical))
            logical = [s]
        elif logical and s and not s.startswith(">") and not s.startswith("#"):
            logical.append(s)
        elif logical:
            rows.append(" ".join(logical))
            logical = []
    if logical:
        rows.append(" ".join(logical))
    total, open_rows = 0, []
    for s in rows:
        is_row = "When" in s or "（验" in s or "则" in s
        if s.startswith("|"):  # 表格行（状态列看末列）
            cells = [c.strip() for c in s.strip("|").split("|")]
            if len(cells) < 2 or cells[0] in ("#", "—") or set(cells[0]) <= {"-", "#", ":", " "}:
                continue  # 表头/分隔行
            total += 1
            if "{{" in s:
                open_rows.append(cells[0][:40] + "（占位未填）")
                continue
            status = cells[-1]
            if not (status.endswith(_ACC_END_MARKS)
                    or any(k in status.lower() for k in _ACC_CELL_KEYWORDS)):
                open_rows.append(cells[0][:40])
        elif is_row:
            total += 1
            if "{{" in s:
                open_rows.append(s.strip("- ").split("（")[0][:40] + "（占位未填）")
            elif not ("（验：" in s and any(m in s for m in _ACC_END_MARKS)):
                # v1.73 宽松化：通过标记任意位置计勾（标记本身即人的验证声明，
                # 位置无语义——056 两次被 endswith 咬的狗粮）；缺（验：命令）
                # 仍=未勾（三件齐才算一条，防假勾）
                open_rows.append(s.strip("- ")[:40])
    return True, total, open_rows


def emit_block(msg, reason_key=""):
    if _NOTIFY_STATE["project_dir"] and not os.environ.get("RG_NO_NOTIFY"):
        try:
            from notify import notify as _notify
            _notify(_NOTIFY_STATE["project_dir"], "blocked",
                    f"⛔ 提交被拦 {_NOTIFY_STATE['manifest_id']}".replace("  ", " "),
                    msg.split("\n")[0][:100],
                    source_id=_NOTIFY_STATE["manifest_id"])  # v1.38：合并键/自动回流的 ref
        except Exception:
            pass  # 推送是增强不是依赖
    print(f"REGRESS-GUARD: {msg}{_recall_hint(reason_key, msg)}", file=sys.stderr)
    sys.exit(2)

def emit_warn(msg):
    print(f"REGRESS-GUARD (warning): {msg}", file=sys.stderr)
    sys.exit(0)


def is_git_commit(tool_input_str):
    """从 hook 的 stdin JSON 判断是否提交类命令。

    覆盖：git commit, git ci, npm version（会触发 commit）,
          pnpm/pnpm publish, yarn version, cz (commitizen),
          husky pre-commit 执行链。
    """
    if not tool_input_str:
        return False
    try:
        data = json.loads(tool_input_str)
        ti = data.get("tool_input", data) if isinstance(data, dict) else {}
        cmd = ti.get("command", "") if isinstance(ti, dict) else ""
        # git commit / git ci
        if re.search(r'\bgit\s+commit\b|\bgit\s+ci\b', cmd):
            return True
        # npm version / npm publish（npm version 会自动 commit）
        if re.search(r'\bnpm\s+(version|publish)\b', cmd):
            return True
        # pnpm publish / yarn version
        if re.search(r'\b(pnpm|yarn)\s+(publish|version)\b', cmd):
            return True
        # commitizen (cz)
        if re.search(r'\bcz\b|\bgit-cz\b', cmd):
            return True
        # husky run hook
        if re.search(r'\bhusky\s+run\b', cmd):
            return True
        return False
    except Exception:
        return False


def _message_from_cmd(tool_input_str):
    """从命令串提取 -m 信息（v1.87.1，092）。

    引号感知（双/单引号体与裸词）；-qm 类组合旗标同样命中。提取不到返回
    空串（三查对空信息不生效——无 -m 的提交形态走编辑器，门禁层无文本）。"""
    try:
        data = json.loads(tool_input_str)
        ti = data.get("tool_input", data) if isinstance(data, dict) else {}
        cmd = ti.get("command", "") if isinstance(ti, dict) else ""
    except Exception:
        return ""
    m = re.search(r'(?:^|\s)-\w*m\w*\s+("([^"]*)"|\'([^\']*)\'|(\S+))', cmd)
    if not m:
        return ""
    return m.group(2) or m.group(3) or m.group(4) or ""


def is_compound_stage_commit(tool_input_str):
    """同一命令串里既暂存又提交（v1.87，091：077/088 标本机器位收口）。

    两个真实代价：①门禁在命令提交瞬间评估暂存区——此刻暂存未执行，归因
    交集退化为回退（088 活体）；②门禁因他规则拦下时暂存被整条吞掉，重试
    若不重新暂存即丢（077 漏提交实证）。检测前剔除 heredoc 体（复用
    boundary_guard 同源防御）与引号段——载荷文本不算命令（v1.77/1.82
    标本族教训）。--amend 豁免：它复用既有暂存，不变更暂存状态。"""
    try:
        data = json.loads(tool_input_str)
        ti = data.get("tool_input", data) if isinstance(data, dict) else {}
        cmd = ti.get("command", "") if isinstance(ti, dict) else ""
    except Exception:
        return False
    if not cmd:
        return False
    t = cmd
    try:
        from boundary_guard import _strip_heredoc_bodies
        t = _strip_heredoc_bodies(t)
    except Exception:
        pass
    t = re.sub(r"'[^']*'", "''", t)
    t = re.sub(r'"[^"]*"', '""', t)
    if re.search(r'\bgit\s+(?:-\S+\s+)*add\b', t):
        return True
    m = re.search(r'\bgit\s+(?:commit|ci)\s+(-[a-zA-Z-]+)?', t)
    if m and m.group(1):
        flag = m.group(1)
        if (not flag.startswith("--") and "a" in flag) or flag == "--all":
            return True
    return False


def find_regress_dir():
    """从多个来源查找 .regress/ 目录。

    查找顺序：
    1. CLAUDE_PROJECT_DIR / ZCODE_PROJECT_DIR（ZCode 传入的工作目录）
    2. git rev-parse --show-toplevel（当前 git 仓库根）→ 看它有没有 .regress/
    3. 从 git root 向上逐级查找（支持 monorepo：.regress/ 在父目录）
    4. 当前工作目录
    """
    # 收集候选目录
    candidates = []
    env_dir = (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
    )
    if env_dir:
        candidates.append(env_dir)
    candidates.append(os.getcwd())

    # 从 git 获取仓库根
    try:
        import subprocess
        git_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5
        ).stdout.strip()
        if git_root:
            candidates.append(git_root)
            # 向上查找（monorepo 场景：.regress/ 在父目录）
            parent = os.path.dirname(git_root)
            while parent and parent != "/":
                candidates.append(parent)
                parent = os.path.dirname(parent)
    except Exception:
        pass

    # 找第一个有 .regress/ 的
    for d in candidates:
        regress_dir = os.path.join(d, ".regress")
        if os.path.isdir(regress_dir):
            return d, regress_dir

    return None, None


def _session_id():
    """本钩子进程的会话身份（v1.34 作用域键）。钩子进程带会话 env
    （活体证据：/tmp/regress-guard-fails-sess_*.jsonl），Bash 工具进程不带——
    缺失返回 ""：门禁退回共享语义（fail-safe 老行为），不误锁。"""
    return (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or ""
    )


def _mark_expected(regress_dir, kind):
    """放行前写标记，供 git 观测钩子区分提交来源（gated/bypass vs 外部直提）。

    观测钩子消费新鲜标记（<5min）后删除；过期标记视为残留，忽略。
    """
    try:
        with open(os.path.join(regress_dir, ".expect-commit"), "w", encoding="utf-8") as f:
            f.write(f"kind={kind}\n")
    except OSError:
        pass


def _git_head_sha():
    """获取当前 HEAD sha（证据链的产出锚点：本次 commit 基于哪个提交）。"""
    try:
        import subprocess
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5
        ).stdout.strip()[:12]
    except Exception:
        return ""


def main():
    # ─── 1. 是否 git commit？──────────────────────────
    raw_input = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not is_git_commit(raw_input):
        emit_pass()

    # ─── 2. 定位项目 + .regress/ ──────────────────────
    project_dir, regress_dir = find_regress_dir()
    if not regress_dir:
        emit_pass()  # 未接入的项目（找不到 .regress/）
    _NOTIFY_STATE["project_dir"] = project_dir  # blocked 推送上下文（P1#5）

    # ─── 2.5 复合暂存+提交形态（v1.87，091）──────────
    if is_compound_stage_commit(raw_input):
        record(regress_dir, "commit_blocked", "",
               reason="compound_stage_commit")
        emit_block(
            "提交被拦：**同一命令串里既暂存又提交**（复合形态）。\n\n"
            "两个真实代价（077/088 标本）：\n"
            "· 门禁在命令提交瞬间评估暂存区——此刻暂存未执行，归因交集退化为回退；\n"
            "· 门禁因其他规则拦下时，暂存被整条命令吞掉，重试若不重新暂存会丢\n"
            "  （077：3 个测试用例漏提交一周后才被发现）。\n\n"
            "正确姿势（分立三步，各自独立调用）：\n"
            "  1. 暂存（git 加路径的命令）\n"
            "  2. git status --short 核对暂存内容\n"
            "  3. 提交命令\n\n"
            "确要复合（如一次性脚本）：/regress:bypass <分钟>（限时赦免，赦后记债）。"
        )

    # 读配置 — fail-safe：config 损坏时用最严格默认（阻断）
    config = {}
    config_file = os.path.join(regress_dir, "config.json")
    if os.path.exists(config_file):
        try:
            with open(config_file, encoding="utf-8") as f:
                config = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            # 配置文件损坏 → 不能猜配置，fail-safe 阻断
            record(regress_dir, "error", error=f"config.json parse failed: {e}")
            emit_block(
                f".regress/config.json 解析失败：{e}\n\n"
                "配置文件损坏，无法确定 strict/bypass 状态。\n"
                "fail-safe 原则：阻断 commit。请修复 config.json 后重试。"
            )
    strict = config.get("strict", True)
    bypass_until = config.get("bypass_until", "")

    # ─── 3. 检查 bypass ───────────────────────────────
    if bypass_until:
        try:
            expired = datetime.now() >= datetime.fromisoformat(bypass_until)
        except (ValueError, TypeError):
            expired = True  # 格式坏 = 过期

        if not expired:
            # bypass 有效 → 记审计日志 + 放行
            log_path = os.path.join(regress_dir, "bypass.log")
            user = getpass.getuser() if hasattr(getpass, "getuser") else os.environ.get("USER", "unknown")
            try:
                with open(log_path, "a", encoding="utf-8") as f:
                    f.write(f"{datetime.now().isoformat()} | bypass commit by {user}\n")
            except OSError:
                pass  # 日志写失败不影响放行（bypass 日志是审计辅助，非关键路径）
            record(regress_dir, "bypass_used", "", expires=bypass_until, user=user)
            _mark_expected(regress_dir, "bypass")
            emit_warn(f"bypass 模式生效（到期: {bypass_until}），已记审计日志。事后请补回归。")
        else:
            # 过期 → 清除 bypass_until（P2#16：filelock+原子写——无锁读改写会
            # 丢并发会话刚写入的新 bypass，写一半崩溃留下半截 JSON=每次提交
            # 都命中"配置损坏 fail-safe 阻断"的 DoS）
            config.pop("bypass_until", None)
            try:
                from filelock import file_lock
                tmp = config_file + ".tmp"
                with file_lock(config_file):
                    with open(tmp, "w", encoding="utf-8") as f:
                        json.dump(config, f, indent=2)
                    os.replace(tmp, config_file)
            except OSError:
                pass  # 清除失败不阻断（下次会再试清除）

    # ─── 4. 查找活跃清单 ──────────────────────────────
    # fail-safe：如果 manifest 文件存在但解析失败 → 阻断（而非放行）
    manifests_dir = os.path.join(regress_dir, "manifests")
    manifest_files_on_disk = sorted(
        __import__("glob").glob(os.path.join(manifests_dir, "*.md")), reverse=True
    ) if os.path.isdir(manifests_dir) else []

    manifest = None
    manifest_id = ""
    my_sid = _session_id()
    mine, others = [], []  # (path, id)：会话作用域（v1.34）
    for mf_path in manifest_files_on_disk:
        parsed = parse_frontmatter(mf_path)
        if parsed is None:
            # 文件存在但无法解析 frontmatter → 格式损坏
            record(regress_dir, "error", error=f"manifest parse failed: {mf_path}")
            emit_block(
                f"回归清单解析失败：{mf_path}\n\n"
                "该文件不是合法的 YAML frontmatter 格式（缺少 --- 包裹或 YAML 语法错误）。\n"
                "fail-safe 原则：阻断 commit。请修复清单格式后重试。"
            )
        # 语义反转：只有明确活跃 status 才算（开放词表下自造词≠活跃）
        if parsed.get("status") in ("planning", "in-progress", "verifying", "blocked"):
            entry = (mf_path, parsed.get("id", ""))
            m_sid = str(parsed.get("session") or "")
            (others if my_sid and m_sid and m_sid != my_sid else mine).append(entry)

    def _others_files():
        """他人活跃清单声明的文件并集（集成态冲突检查的对照面）。"""
        files = set()
        for p, _oid in others:
            files.update(f.replace(os.sep, "/") for f in get_all_changed_files(p))
        return files

    _relevant_subs = None

    def _relevant_subrepos():
        """声明相关性锚定（088 二修）：只扫活跃清单（mine+others）声明文件
        落在的一级子仓——全子仓并集会捞进无关项目的历史暂存（活体：demo-project
        的 src/math.js 拦了 regress-guard 的提交）。声明文件在哪个子仓存在，
        哪个子仓才是本治理现场。"""
        nonlocal _relevant_subs
        if _relevant_subs is None:
            _relevant_subs = []
            decl = set()
            for p, _m in mine + others:
                decl.update(f.replace(os.sep, "/")
                            for f in get_all_changed_files(p))
            if decl:
                try:
                    for name in sorted(os.listdir(project_dir)):
                        sub = os.path.join(project_dir, name)
                        if (name.startswith(".") or not os.path.isdir(sub)
                                or not os.path.exists(os.path.join(sub, ".git"))):
                            continue
                        if any(os.path.exists(os.path.join(sub, *d.split("/")))
                               for d in decl):
                            _relevant_subs.append(sub)
                except Exception:
                    pass
        return _relevant_subs

    def _staged_list():
        """暂存清单（088 拓扑补：并集工作区仓+相关子仓）。

        .regress/ 是治理数据不参与 F3；嵌套仓拓扑下提交发生在子仓——只读
        工作区仓暂存恒空（088 活体标本：交集归因两连退回 fallback），故并入
        相关子仓（声明锚定）的暂存，路径保持子仓相对=清单声明空间。
        F3/跨会话冲突检查同获此修正——它们此前对嵌套仓提交同盲。"""
        base = [s for s in filter_files(get_staged_files(project_dir))
                if not s.replace(os.sep, "/").startswith(".regress/")]
        for sub in _relevant_subrepos():
            try:
                r = subprocess.run(
                    ["git", "-C", sub, "diff", "--cached", "--name-only"],
                    capture_output=True, text=True, timeout=10)
                if r.returncode == 0:
                    base += [l.strip().replace(os.sep, "/")
                             for l in r.stdout.splitlines()
                             if l.strip()
                             and not l.strip().replace(os.sep, "/").startswith(".regress/")]
            except Exception:
                pass  # 子仓扫描是增强：失败回到仅工作区仓（老行为）
        return base

    if mine:
        def _attribute_mine(mine_list, staged):
            """归因（v1.86.2，088）：多活跃清单在场按 staged 交集选归因者。

            run8 双标本根治：旧 mine[0]（文件名倒序首个）与提交文件无关且不筛
            临行状态——planning 清单被路过盖 done（084）、真清单反漏盖
            （081/082/083）。planning（未临行）不参与交集归因；全无交集=异常态
            回退有 provisional 戳者保检查面（弱化不允许），再退旧序。"""
            staged_set = {s.replace(os.sep, "/") for s in staged}
            best, best_n = None, 0
            for p, mid in mine_list:
                parsed = parse_frontmatter(p) or {}
                if str(parsed.get("status") or "") == "planning":
                    continue
                declared = {f.replace(os.sep, "/")
                            for f in get_all_changed_files(p)}
                n = len(declared & staged_set)
                if n > best_n:
                    best, best_n = (p, mid), n
            if best:
                return best
            for p, mid in mine_list:
                if (parse_frontmatter(p) or {}).get("provisional"):
                    return (p, mid)
            return mine_list[0]

        manifest, manifest_id = _attribute_mine(mine, _staged_list())
        if len(mine) > 1:
            record(regress_dir, "note", manifest_id,
                   note="co_active", co_active=len(mine),
                   attributed=manifest_id or "planning_fallback")
        _NOTIFY_STATE["manifest_id"] = manifest_id  # blocked 推送带清单号

        # ─── 2.6 提交信息早查（v1.87.1，092）────────────
        # 行业空白位（探子 2026-09-21：无人做信息-实况对账）+077 标本（信息宣称
        # 536/536+3 用例而树里没有，溜一周）。晚查（行尾计数对账）挂 pass 路径——
        # 需门禁实测数。
        _msg = _message_from_cmd(raw_input)
        if _msg:
            _mtier = str((parse_frontmatter(manifest) or {}).get("tier") or "")
            _short = manifest_id.rsplit("-", 1)[-1] if manifest_id else ""
            # 前缀形态（（097 或 (097）即认——含「（097，附注）」实践形态；
            # 096 活体：发布道曾硬拦自家镜像消息，门禁侧 M 档同款误拦面
            _has_ref = (manifest_id and manifest_id in _msg) or bool(
                _short and re.search(r"[（(]" + re.escape(_short), _msg))
            if not _has_ref:
                if _mtier in ("M", "L"):
                    record(regress_dir, "commit_blocked", manifest_id,
                           reason="message_no_manifest_ref")
                    emit_block(
                        f"提交被拦：信息缺归因清单号（077 反谎报配套——git log 溯源锚）。\n\n"
                        f"归因清单 <id {manifest_id}>，信息中嵌入全 ID 或缩写"
                        f"「（{_short}）」形态即可。git log --grep 清单号=批的物理\n"
                        "提交秒查（我们直提 main，提交信息是唯一溯源面——top1 有 PR 层"
                        "放 PR body，拓扑不同）。"
                    )
                else:
                    record(regress_dir, "note", manifest_id,
                           note="message_no_manifest_ref_warn")
                    print(f"REGRESS-GUARD: ⚠️ 信息缺清单号 {manifest_id}（S/quick 档告警，"
                          "建议嵌入全 ID 或（缩写））", file=sys.stderr)
            if "<" in _msg or ">" in _msg:
                record(regress_dir, "commit_blocked", manifest_id,
                       reason="message_angle_bracket")
                emit_block(
                    "提交被拦：信息含尖括号 < 或 >。\n\n"
                    "运营实证双坑：边界守卫会把 <路径> 形态当重定向目标误判；"
                    "发布链路的文案约定同样禁尖括号。改用「路径」或（路径）形态。"
                )

    if not manifest:
        if others:
            # 我无清单、他会话有活跃清单：只拦真冲突（staged 撞其清单文件），
            # 否则放行+警示——他人清单不再挡我的提交（标本1 根治）
            try:
                clash = sorted({s.replace(os.sep, "/") for s in _staged_list()}
                               & _others_files())
            except Exception as e:
                record(regress_dir, "error", "", error=f"diff analysis failed: {e}")
                emit_block(
                    f"git diff 分析失败：{e}\n\n"
                    "fail-safe 原则：阻断 commit。请检查 git 状态后重试。"
                )
            ids = ", ".join(oid or os.path.basename(p) for p, oid in others[:3])
            if clash:
                files_str = "\n  ".join(clash)
                record(regress_dir, "commit_blocked", "",
                       reason="cross_session_clash", clash_files=clash,
                       foreign=ids, session=my_sid)
                emit_block(
                    f"commit 被阻断。以下 staged 文件在他会话的活跃清单内"
                    f"（跨会话文件冲突——各自分支都对，合到一起才现形）：\n"
                    f"  {files_str}\n\n对方清单：{ids}\n\n"
                    "· 与该会话串行作业，或让人类仲裁归属\n"
                    "· 该会话已死？哨兵视图确认后收尾其清单或重盖 session 戳：\n"
                    "  python3 hooks/scripts/lib/sentinel.py\n"
                    "· 确要抢收：/regress:bypass <分钟>（限时赦免，赦后记债）"
                )
            record(regress_dir, "commit_passed", "",
                   runner="none", passed=0, total=0,
                   note="foreign_active_manifest_untouched", foreign=ids)
            _mark_expected(regress_dir, "gated")
            emit_warn(
                f"其他会话有活跃清单（{ids}），但不涉本次提交文件——已放行"
                "（会话作用域 v1.34：他人清单不再挡你的提交）。")
        else:
            # 没有活跃清单 → 放行，但要记录（否则 history 永远空）
            record(regress_dir, "commit_passed", "",
                   runner="none", passed=0, total=0,
                   note="no_active_manifest")
            _mark_expected(regress_dir, "gated")
            emit_pass()

    # ─── 4.5 全貌层两规则（v1.40：理解是强制产物）────────
    # 病例：028 新增桥脚本（模块结构变更）而卡片 8 天未回写，两批跳过 finish
    # 卡片步骤，无机器拦——纪律位升机器位。对标 spec-first：理解必须落产物。
    def _scan_ok(v):
        v = str(v or "").strip()
        return bool(v) and "{{" not in v and v.upper() != "TODO"

    _mp_scan = parse_frontmatter(manifest) or {}
    _tier = str(_mp_scan.get("tier") or "").strip().upper()

    # 规则A（仅 M/L——S 档轻量合法不背全貌仪式）：scan 三行 + understood_intent 三件
    if _tier in ("M", "L"):
        _missing = [k for k in ("entry", "test", "card")
                    if not _scan_ok((_mp_scan.get("scan") or {}).get(k))]
        _ui = _mp_scan.get("understood_intent")
        _ui_ok = (isinstance(_ui, dict) and
                  all(_scan_ok(_ui.get(k)) for k in ("复述", "边界", "判据")))
        if _missing or not _ui_ok:
            record(regress_dir, "commit_blocked", manifest_id,
                   reason="scan_missing", missing=_missing,
                   ui_ok=bool(_ui_ok), tier=_tier)
            emit_block(
                f"M/L 档清单缺全貌产物（v1.40 规则A）：<id {manifest_id}>\n\n"
                + (f"· scan 三行缺项：{', '.join(_missing)}\n" if _missing else "")
                + ("" if _ui_ok else "· understood_intent 须三件（复述/边界/判据），"
                   "空值/占位不算\n")
                + "\n补法：清单 frontmatter 加\n  scan:\n    entry: <入口在哪>\n"
                  "    test: <测试怎么跑>\n    card: <动的是哪张模块卡>\n"
                  "  understood_intent:\n    复述/边界/判据 各一行非空\n"
                  "（对标 spec-first：理解是强制产物——看不全就对不准）",
                reason_key="scan_missing"
            )

    # 规则B（全档含 S/quick——结构变更本就不是轻量内部，028 标本即 S 可绕的洞）：
    # staged 有结构性增删改名（ADR；tests/docs/md 是模块元数据豁免）→ 卡片须随同 staged
    try:
        import subprocess as _sp
        _r = _sp.run(["git", "-C", project_dir, "diff", "--staged",
                      "--diff-filter=ADR", "--name-only", "-z"],
                     capture_output=True, text=True, timeout=10)
        _ad = [f for f in (_r.stdout.split("\0") if _r.returncode == 0 else [])
               if f and not f.replace(os.sep, "/").startswith(".regress/")
               and not f.replace(os.sep, "/").startswith("tests/")
               and not f.replace(os.sep, "/").startswith("docs/")
               and not f.endswith(".md")]
    except Exception:
        _ad = []
    if _ad:
        _card_path = os.path.join(regress_dir, "product-arch.md")
        _card_staged = any(
            s.replace(os.sep, "/") == ".regress/product-arch.md"
            for s in filter_files(get_staged_files(project_dir)))
        # 显式豁免位（FP1 rescue）：纯脚手架确不需进卡，清单声明并写明理由
        _sync_exempt = (_mp_scan.get("scan") or {}).get("card_sync") is False
        if os.path.exists(_card_path) and not _card_staged and not _sync_exempt:
            record(regress_dir, "commit_blocked", manifest_id,
                   reason="card_stale", structural=_ad[:6], tier=_tier or "S?")
            emit_block(
                f"模块结构变更而卡片未同步（v1.40 规则B）：<id {manifest_id}>\n\n"
                f"结构性增删/改名：\n  {chr(10).join(_ad[:6])}\n\n"
                "模块卡片是活档案（.regress/product-arch.md）——结构变了卡片要跟着动"
                "（finish 步骤 4），本次提交未包含卡片变更。\n"
                "· 补法：更新对应模块卡（能力增行/缺口增删）后一并 staged\n"
                "· 纯脚手架确不需进卡：清单 scan 加 card_sync: false 并写明理由"
            )
        elif not os.path.exists(_card_path):
            # 无卡片的盲区（顾问补强）：不拦（未接入产品层），但警示留痕
            record(regress_dir, "commit_warned", manifest_id,
                   note="structural_change_without_cards", structural=_ad[:6])
            print(f"REGRESS-GUARD (warning): 结构性变更（{len(_ad)} 文件）但项目无模块卡片——"
                  "建议 /regress:init 建产品层（全貌是强制产物的起点）", file=sys.stderr)

    # ─── 4.6 收官两规则（v1.41：触发表激活，防空转）─────
    # 顾问重塑：rollback=能力断言+引信（全档，写不出即不该提交；默认只在无逃逸面
    # 时合法）；self_review 键触发表激活——不适用=键不出现（合法），「无」只表示
    # 查过没有——堵"无/不适用混装"的空转根源（REGRESS-2026-030）。
    def _v_ok(v):
        v = str(v or "").strip()
        return bool(v) and "{{" not in v and v.upper() != "TODO"

    _rollback = str(_mp_scan.get("rollback") or "").strip()
    if not _v_ok(_rollback):
        record(regress_dir, "commit_blocked", manifest_id,
               reason="finish_missing", part="rollback")
        emit_block(
            f"清单缺 rollback（v1.41：能力断言+引信——写不出即不该提交）：<id {manifest_id}>\n\n"
            "· 一行即可：rollback: git revert 即回滚\n"
            "· 触及迁移/删数据/外部状态时默认失效，须写具体回滚路径"
            "（数据怎么回/迁移怎么退）"
        )

    # 触发表数据一次取齐：staged 全量 + diff 文本
    try:
        import subprocess as _sp2
        _dr = _sp2.run(["git", "-C", project_dir, "diff", "--staged", "-U0"],
                       capture_output=True, text=True, timeout=10)
        _diff_text = _dr.stdout if _dr.returncode == 0 else ""
        _staged_all = filter_files(get_staged_files(project_dir))
    except Exception:
        _diff_text, _staged_all = "", []

    _ESCAPE_PATH = re.compile(r"migrations?/|schema|db/seed|alembic|flyway", re.I)
    _ESCAPE_SQL = re.compile(r"DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE|DELETE\s+FROM", re.I)
    if ((any(_ESCAPE_PATH.search(s) for s in _staged_all)
         or _ESCAPE_SQL.search(_diff_text))
            and "git revert" in _rollback.lower() and len(_rollback) < 40):
        record(regress_dir, "commit_blocked", manifest_id,
               reason="finish_missing", part="rollback_default_on_escape")
        emit_block(
            f"rollback 默认值在逃逸面上失效（v1.41）：<id {manifest_id}>\n\n"
            "本次提交触及迁移/schema/破坏性 SQL——「git revert 即回滚」不够"
            "（revert 得回代码回不了数据），须写具体回滚路径：\n"
            "· 迁移怎么退（down 脚本？手工 SQL？备份恢复？）\n"
            "· 数据怎么回（备份点/可重放源？）"
        )

    _sr = _mp_scan.get("self_review") or {}
    _keys_needed = []
    if _mp_scan.get("actual_changes"):
        _keys_needed.append("计划外")
    if (re.search(r"console\.(?:log|debug)|debugger\b|pdb\.set_trace|breakpoint\(",
                  _diff_text)
            and any(not s.replace(os.sep, "/").startswith("tests/")
                    for s in _staged_all)):
        _keys_needed.append("调试残留")
    _missing_sr = [k for k in _keys_needed if not _v_ok(_sr.get(k))]
    if _missing_sr:
        record(regress_dir, "commit_blocked", manifest_id,
               reason="finish_missing", part="self_review", keys=_missing_sr)
        emit_block(
            f"self_review 缺键（触发表已激活，v1.41）：<id {manifest_id}>\n\n"
            f"需补：{', '.join(_missing_sr)}\n"
            "· 计划外键：清单回写过计划外文件（F3）——逐个有意识看过吗？"
            "值=具体条目或「无」（查过没有）\n"
            "· 调试残留键：diff 命中调试模式（print/console.log/debugger/pdb）——"
            "值=条目或「无」\n"
            "（不适用=键不出现即合法；本清单触发了，键必须在——防空转）"
        )

    # ─── 4.7 供应链（v1.42：门禁只验测试不够，还要验安全）───
    # secrets：gitleaks-lite 扫 staged 新增行（历史密钥是全仓审计工具的职责）
    # deps：锁文件 staged 才触发 npm audit --json（顾问修正：解析漏洞计数，
    #       exit code 不可信）——infra 失败 fail-open（warn+留痕），
    #       findings fail-closed（high/critical 才拦）
    _sc_cfg = config.get("supply_chain") or {}
    if _sc_cfg.get("secrets", True):
        try:
            from secret_scan import scan_added_lines
            _hits = scan_added_lines(_diff_text,
                                     allowlist=_sc_cfg.get("allowlist") or ())
        except Exception:
            _hits = []
        if _hits:
            record(regress_dir, "commit_blocked", manifest_id,
                   reason="secret_leak",
                   hits=[list(h[:3]) for h in _hits[:5]])
            _hit_str = "\n".join(f"  · {n} {f}:{ln} {s}" for n, f, ln, s in _hits[:5])
            emit_block(
                f"staged 新增行疑似密钥泄漏（v1.42 供应链层）：<id {manifest_id}>\n\n"
                f"{_hit_str}\n\n"
                "· 真密钥：撤销轮换（进了 git 历史就算删了也已泄漏），用 env/凭据库\n"
                "· 文档示例/教学串：config supply_chain.allowlist 加值\n"
                "· 确要提交：/regress:bypass <分钟>（限时赦免+审计留痕）"
            )

    if _sc_cfg.get("deps", True):
        _lock_bases = ("package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                       "poetry.lock", "go.sum", "Cargo.lock")
        # 原始 staged（不经 filter_files——它会滤 .md/test/锁类"噪音"，锁恰是本规则的靶）
        _locks = [s for s in get_staged_files(project_dir)
                  if os.path.basename(s) in _lock_bases
                  or s.replace(os.sep, "/").startswith("requirements")]
        if any(os.path.basename(l) == "package-lock.json" for l in _locks):
            import subprocess as _sp3
            _tmo = float(os.environ.get("RG_AUDIT_TIMEOUT_S", "60"))
            try:
                _ar = _sp3.run(
                    [os.environ.get("RG_NPM_CMD", "npm"), "audit", "--json",
                     "--package-lock-only"],
                    cwd=project_dir, capture_output=True, text=True, timeout=_tmo)
                _vulns = ((json.loads(_ar.stdout or "{}").get("metadata") or {})
                          .get("vulnerabilities") or {})
                _hi = int(_vulns.get("high", 0)) + int(_vulns.get("critical", 0))
                if _hi > 0:
                    record(regress_dir, "commit_blocked", manifest_id,
                           reason="deps_vulnerable", high=_hi,
                           total=_vulns.get("total", 0))
                    emit_block(
                        f"依赖存在 { _hi } 个 high/critical 已知漏洞"
                        f"（v1.42 供应链层）：<id {manifest_id}>\n\n"
                        f"npm audit 汇总：{json.dumps(_vulns, ensure_ascii=False)}\n"
                        "· npm audit 逐条看影响路径，升级或豁免有据后重试\n"
                        "· 误报/暂不修：config supply_chain.deps=false（降级要写明理由）"
                    )
            except Exception as _e:  # 工具缺/超时/JSON 坏/网络败（SystemExit 不受捕）
                record(regress_dir, "commit_warned", manifest_id,
                       note="deps_audit_infra_fail", error=str(_e)[:80])
                print(f"REGRESS-GUARD (warning): npm audit 未完成（{_e.__class__.__name__}）"
                      "——infra fail-open 放行，findings 才 fail-closed", file=sys.stderr)
        elif _locks:
            print(f"REGRESS-GUARD (warning): 锁文件变更（{os.path.basename(_locks[0])}）"
                  "但该生态审计器 v1 未接入（仅 npm）——建议人工审计", file=sys.stderr)

    # ─── 5. staged 文件在清单内？──────────────────────
    try:
        manifest_files = get_all_changed_files(manifest)
        staged = _staged_list()
        untracked = find_untracked_changes(staged, manifest_files)
    except Exception as e:
        record(regress_dir, "error", manifest_id, error=f"diff analysis failed: {e}")
        emit_block(
            f"git diff 分析失败：{e}\n\n"
            "fail-safe 原则：阻断 commit。请检查 git 状态后重试。"
        )

    # 5.4 跨会话冲突（v1.34）：先于 untracked 检查——否则"不在清单中"的提示
    # 会误导去 /regress:track 把他人文件认领进我的清单（方向反了）
    if my_sid and others:
        clash = sorted({s.replace(os.sep, "/") for s in staged} & _others_files())
        if clash:
            files_str = "\n  ".join(clash)
            ids = ", ".join(oid or os.path.basename(p) for p, oid in others[:3])
            record(regress_dir, "commit_blocked", manifest_id,
                   reason="cross_session_clash", clash_files=clash,
                   foreign=ids, session=my_sid)
            emit_block(
                f"commit 被阻断。以下 staged 文件同时在他会话的活跃清单内"
                f"（跨会话文件冲突——各自分支都对，合到一起才现形）：\n"
                f"  {files_str}\n\n对方清单：{ids}\n\n"
                "· 与该会话串行作业，或让人类仲裁归属\n"
                "· 该会话已死？哨兵视图确认后收尾其清单或重盖 session 戳：\n"
                "  python3 hooks/scripts/lib/sentinel.py\n"
                "· 确要抢收：/regress:bypass <分钟>（限时赦免，赦后记债）"
            )

    if untracked:
        files_str = "\n  ".join(untracked)
        msg = f"commit 被阻断。以下 staged 文件不在回归清单中：\n  {files_str}\n\n请先运行 /regress:track 回写，或 git reset 撤销。\n清单：{manifest}"
        record(regress_dir, "commit_blocked", manifest_id,
               reason="untracked_files", untracked_files=untracked)
        if strict:
            emit_block(msg)
        else:
            emit_warn(msg)

    # ─── 5.5 脆弱点挂牌检查（公理一：未挂牌的脆弱点才是真正的未知风险）──
    fps = get_fragile_points(manifest)
    open_fps = [fp for fp in fps if str(fp.get("status", "open")).lower() == "open"]
    flagged_fps = [fp for fp in fps if str(fp.get("status", "")).lower() == "flagged"]
    if open_fps:
        lines = "\n  ".join(
            f"{fp.get('id', '?')} [{fp.get('kind', '?')}] {fp.get('description', '')}"
            for fp in open_fps
        )
        msg = (
            f"commit 被阻断。清单有 {len(open_fps)} 个脆弱点未挂牌（status: open）：\n"
            f"  {lines}\n\n"
            "公理一：成功不是跑通，而是所有已知脆弱点被锁死或显式挂牌。\n"
            "每个脆弱点二选一后回写清单：\n"
            "  - locked：verify 命令实测通过（跑 /regress:verify 或手动执行后回写）\n"
            "  - flagged：显式带病挂牌（description 里写明知悉的原因）"
        )
        record(regress_dir, "commit_blocked", manifest_id,
               reason="fragile_point_open",
               fragile_ids=[fp.get("id", "?") for fp in open_fps])
        if strict:
            emit_block(msg)
        else:
            emit_warn(msg)
    elif flagged_fps:
        # 带病挂牌 = 显式知情，放行但留痕（不刷屏，stderr 一行）
        print(
            f"REGRESS-GUARD: ⚠️ {len(flagged_fps)} 个脆弱点带病挂牌（flagged）随本提交入库："
            + ", ".join(fp.get("id", "?") for fp in flagged_fps),
            file=sys.stderr,
        )

    # ─── 5.6 证据律复验（公理一：locked = verify 现在能过，不是曾经能过）──
    #      locked 是唯一宣称"已锁死"的状态——门禁处机器复跑 verify 命令，
    #      AI 自封的 locked 不算数。无 verify 命令的 locked = 证据链缺环（警告）。
    #      感官分支（v1.19 AVS 公理三）：verify 以 human_check: 开头的 locked 条目，
    #      机器验证"人确认过"这个事实的化石存在——不复跑感官（人只是传感器，
    #      传感器读数入档即证据）。
    import subprocess as _sp
    locked_no_verify = [
        fp for fp in fps
        if str(fp.get("status", "")).lower() == "locked" and not str(fp.get("verify") or "").strip().strip('"')
    ]
    for fp in locked_no_verify:
        print(
            f"REGRESS-GUARD: ⚠️ {fp.get('id', '?')} 自称 locked 但无 verify 命令——"
            f"证据链缺环，建议补命令（/regress:verify 拿证据）或改 flagged 显式挂牌",
            file=sys.stderr,
        )
    verify_failed = []

    # 感官分支：human_check 化石存在性检查
    human_fps = [f for f in fps
                 if str(f.get("status", "")).lower() == "locked"
                 and str(f.get("verify") or "").strip().startswith("human_check")]
    if human_fps:
        jevents = []
        try:
            with open(os.path.join(regress_dir, "journal", "events.jsonl"),
                      encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            jevents.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
        except (IOError, OSError):
            pass
        for fp in human_fps:
            vid = fp.get("id", "?")
            has = any(e.get("kind") == "human_check"
                      and e.get("manifest_id") == manifest_id
                      and e.get("vid") == vid for e in jevents)
            record(regress_dir, "fragile_verify", manifest_id, vid=vid, ok=has)
            if not has:
                verify_failed.append(
                    (vid, "human_check", "无 human_check 化石（人工确认未落产物）："
                     f'journal.py . add human_check \'{{"manifest_id":"{manifest_id}","vid":"{vid}","result":"pass"}}\''))

    for fp in [f for f in fps
               if str(f.get("status", "")).lower() == "locked"
               and str(f.get("verify") or "").strip().strip('"')
               and not str(f.get("verify") or "").strip().startswith("human_check")][:5]:  # 上限5条防门禁拖延
        vcmd = str(fp["verify"]).strip()
        try:
            r = _sp.run(["bash", "-c", vcmd], capture_output=True, text=True,
                        timeout=15, cwd=project_dir)
            ok = r.returncode == 0
            tail = (r.stderr or r.stdout or "")[-150:].strip()
        except Exception as e:
            ok, tail = False, str(e)[:150]
        record(regress_dir, "fragile_verify", manifest_id,
               vid=fp.get("id", "?"), ok=ok)
        if not ok:
            verify_failed.append((fp.get("id", "?"), vcmd[:60], tail))
    if verify_failed:
        lines = "\n  ".join(
            f"{vid}: `{cmd}` → {tail or 'exit≠0（无输出）'}"
            for vid, cmd, tail in verify_failed
        )
        msg = (
            f"commit 被阻断。{len(verify_failed)} 个 locked 脆弱点门禁复验失败"
            f"（证据律：locked 意为 verify 此刻能过）：\n  {lines}\n\n"
            "修复后重试，或降级为 flagged 显式带病挂牌（写明知悉原因）。"
        )
        record(regress_dir, "commit_blocked", manifest_id,
               reason="fragile_verify_failed",
               failed_ids=[vid for vid, _, _ in verify_failed])
        if strict:
            emit_block(msg, reason_key="fragile_verify_failed")
        else:
            emit_warn(msg)

    # ─── 6. hook 自己跑测试 ───────────────────────────
    print("REGRESS-GUARD: 正在运行测试...", file=sys.stderr)
    # v1.85 测试结果缓存（074）：同树重试三跑全量是最大浪费；顾问裁=优化位非安全
    # 边界。命中只替代 6 节全量，6.5 验收入环照跑——验收读的是清单不是树。
    _cache_hit = None
    try:
        from test_cache import lookup as _tc_lookup
        _cache_hit = _tc_lookup(project_dir, regress_dir)
    except Exception:
        _cache_hit = None  # 缓存是增强不是依赖，任何异常=旁路
    if _cache_hit:
        result = dict(_cache_hit.get("result") or {})
        result["cached"] = True
        print(f"REGRESS-GUARD: ♻️ 测试缓存命中（同一棵树 "
              f"{str(_cache_hit.get('key'))[:8]}, {str(_cache_hit.get('age_min'))} 分钟前"
              f"的通过结果）——跳过全量重跑；RG_TEST_CACHE=off 可关", file=sys.stderr)
    else:
        try:
            result = run_tests(project_dir)
        except Exception as e:
            record(regress_dir, "error", manifest_id, error=f"test_runner crashed: {e}")
            emit_block(
                f"测试运行器异常崩溃：{e}\n\n"
                "fail-safe 原则：阻断 commit。请检查测试运行器配置。\n"
                f"Traceback:\n{traceback.format_exc()[-500:]}"
            )
    status = result.get("status", "fail")
    runner = result.get("runner", "unknown")

    if status == "pass":
        # ─── 6.5 验收入环（v1.55：M/L done 盖章前验收行全勾）─────────
        # 验收=需求侧 done 定义——没有它 done 就是自我宣布。验命令本批不
        # 复跑（顾问：全量测试已跑，复跑多重复；自证谎报等字段数据再上执行器）。
        # S 档/quick 豁免（轻量合法不破）。
        if _tier in ("M", "L") and str((_mp_scan or {}).get("mode") or "") != "quick":
            present, total, open_rows = _acceptance_state(manifest)
            if not present or total == 0:
                record(regress_dir, "commit_blocked", manifest_id,
                       reason="acceptance_missing", tier=_tier)
                emit_block(
                    f"M/L 清单缺验收标准判据（v1.55 验收入环）：<id {manifest_id}>\n\n"
                    "验收标准节缺失或没有可认出的判据行——门禁复验脆弱点、"
                    "跑全量测试，唯独没人查「需求做没做对」。\n\n"
                    "补法：清单加「## 验收标准」节，每行 EARS-lite：\n"
                    "  - When 条件，则 可观察结果（验：当场可跑命令）\n"
                    "验证过一行就在行尾加 ✅；S 档/quick 模式豁免本规则"
                )
            elif open_rows:
                _rows = "\n  ".join(f"· {r}" for r in open_rows[:5])
                record(regress_dir, "commit_blocked", manifest_id,
                       reason="acceptance_open", n=len(open_rows), tier=_tier)
                emit_block(
                    f"M/L 清单有 {len(open_rows)} 行验收未勾（v1.55 验收入环）：<id {manifest_id}>\n\n"
                    f"{_rows}\n\n"
                    "验收行没验证过就盖章 done = 纸面反馈。补法：逐行跑（验：命令），"
                    "通过后行内加 ✅/已验/通过（v1.73 起任意位置计勾，如"
                    "（验：命令）5/5 passed ✅；表格式状态列写 pass/done/locked）；\n"
                    "判据行本身缺（验：命令）= 不完整判据（三件齐才算一条），补全再勾"
                )
            else:
                # 通过也留痕（v1.60）：拦截/通过频次比 = FP2（✅ 自证谎报）
                # 要不要上验命令复跑执行器的决策数据——先有开火数据再谈执行器
                record(regress_dir, "acceptance_passed", manifest_id,
                       rows=total, tier=_tier)
        passed = f"{result['passed']}/{result['total']}"
        # 行尾计数对账（v1.87.1，092 晚查）：「；N/N」结尾=套件计数宣称（家规
        # 形态）——077 的「536/536」正是此形态，当场会被拦。非行尾 N/N（如
        # 「清单健康 59/59」作用域计数）只告警留痕（090 不误伤）。
        _msg_late = _message_from_cmd(raw_input)
        _marker = re.search(r"[；;]\s*(\d+)\s*/\s*(\d+)\s*$", _msg_late.strip())
        if _marker:
            _cp, _ct = int(_marker.group(1)), int(_marker.group(2))
            if not (_cp == result.get("passed") and _ct == result.get("total")):
                record(regress_dir, "commit_blocked", manifest_id,
                       reason="message_count_mismatch",
                       claimed=f"{_cp}/{_ct}",
                       actual=f"{result.get('passed')}/{result.get('total')}")
                emit_block(
                    f"提交被拦：信息行尾「；{_cp}/{_ct}」与门禁实测 "
                    f"{result.get('passed')}/{result.get('total')} 不符。\n\n"
                    "行尾「；N/N」是套件计数宣称（077 反谎报闸：信息宣称 536/536"
                    "而树里没有的那次，溜了一周）。改法：改成实测数，或去掉行尾"
                    "计数（作用域计数写中间位置不受此查）。"
                )
        else:
            _claims = re.findall(r"\d+\s*/\s*\d+", _msg_late)
            if _claims:
                record(regress_dir, "note", manifest_id,
                       note="message_count_claim", claims=_claims[:3])
        _attrib_status = str((parse_frontmatter(manifest) or {}).get("status") or "")
        if _attrib_status == "planning":
            # 未临行的计划不接 done 盖章（088：084 被路过盖章标本的兜底闸）
            record(regress_dir, "note", manifest_id,
                   note="planning_not_stamped")
            print("REGRESS-GUARD: 归因清单为 planning（未临行）——不盖 done，仅放行留痕",
                  file=sys.stderr)
        else:
            try:
                update_frontmatter(manifest, {
                    "status": "done",
                    "test_verified_by": "hook",
                    "test_result": f"{passed} passed",
                })
            except Exception as e:
                # 写清单失败不阻断（测试已通过，清单写入是辅助记录）
                print(f"REGRESS-GUARD: ⚠️ 清单更新失败（不影响放行）: {e}", file=sys.stderr)
        record(regress_dir, "commit_passed", manifest_id,
               runner=runner, passed=result.get("passed"), total=result.get("total"),
               base_head=_git_head_sha(), coverage_pct=result.get("coverage_pct"),
               cached=bool(result.get("cached")),
               cache_key=(str(_cache_hit.get("key")) if _cache_hit else None))
        # 缓存落账（074）：真跑通过才写（命中路径不重写——条目已在）；增强位，失败静默
        if not result.get("cached"):
            try:
                from test_cache import record as _tc_record
                _tc_record(project_dir, regress_dir, result)
            except Exception:
                pass
        # v1.71 待决自动回流（run4 R3）：同清单过门禁=该清单的 blocked 告警自然
        # 闭环——唯一自动策略（顾问禁令：不跨策略不批量不推断，只 resolve 同 ref
        # 未决）；resolved 单列不进误报率分母（校准口径 human-only 不变）。
        try:
            from pending import resolve_by_ref
            _n = resolve_by_ref(manifest_id, outcome="resolved")
            if _n:
                print(f"REGRESS-GUARD: 待决自动回流 {_n} 笔"
                      f"（同清单 {manifest_id} 过门禁 → 闭环）", file=sys.stderr)
        except Exception:
            pass  # 回流是增强不是依赖
        cov_note = f"，覆盖率 {result['coverage_pct']}%" if result.get("coverage_pct") is not None else ""
        print(f"REGRESS-GUARD: ✅ 测试通过 ({passed}){cov_note}，清单已标记 done", file=sys.stderr)
        _mark_expected(regress_dir, "gated")
        emit_pass()

    elif status == "skip":
        # 无测试运行器 → 活跃清单存在但缺 runner：这仍需人工确认，阻断
        mstatus = get_manifest_status(manifest)
        # quick 豁免（v1.37，P1#19）：mode: quick = 机器判据达标的小改动
        # （≤3文件/纯内部/无环境变更），runner 缺失 warn 放行留痕——
        # 塌方曲线的修复方向是"豁免留痕可审计"，不是"伪装 full 被绕过"
        # 顾问防线：豁免本身过机器校验——清单实际文件数 >3 则豁免不成立
        _mp = parse_frontmatter(manifest) or {}
        _quick_files = len(get_all_changed_files(manifest))
        if str(_mp.get("mode") or "") == "quick" and _quick_files <= 3:
            record(regress_dir, "commit_passed", manifest_id,
                   runner=runner, passed=0, total=0,
                   note="quick_no_runner_exempt", files=_quick_files)
            _mark_expected(regress_dir, "gated")
            emit_warn(f"quick 模式清单无测试运行器（mode: quick 豁免，已留痕 history）。")
        # 注：能走到这里说明清单是明确活跃的（planning/in-progress/verifying），
        # 否则 main() 早就以 no_active_manifest 放行了
        # （P1#11 去重：旧行为连记两条同毫秒 record——stats 的比率全体翻倍）
        record(regress_dir, "commit_blocked", manifest_id,
               reason="no_test_runner", runner=runner, manifest_status=mstatus)
        msg = (
            f"未检测到测试运行器（{runner}），无法自动验证测试。\n"
            f"清单状态为 {mstatus}（需改为 done/completed 才能放行）。\n\n"
            "解决方法：\n"
            "  - Java 项目：确保 mvn 在 PATH（brew install maven / apt install maven）\n"
            "  - Node 项目：npm i -D jest\n"
            "  - Python 项目：pip install pytest\n"
            "  - 或在清单中标记 status: done（手动确认无需测试）"
        )
        if strict:
            emit_block(msg)
        else:
            emit_warn(msg)

    else:
        # 测试失败 → 阻断
        failures = result.get("failures", [])[:5]
        lines = []
        for f in failures:
            lines.append(f"  ❌ {f.get('test', '?')}")
            if f.get("message"):
                lines.append(f"     {f['message'][:120]}")
        lines.append(f"\n  共 {result.get('failed', 0)} 个失败 / {result.get('passed', 0)} 个通过")
        fail_str = "\n".join(lines) if lines else "  (详情见测试输出)"
        # 记录每个失败用例
        for f in failures:
            record(regress_dir, "test_failed", manifest_id,
                   runner=runner, test_name=f.get("test", "?"))
        record(regress_dir, "commit_blocked", manifest_id,
               reason="test_failed", runner=runner,
               failed=result.get("failed", 0), passed=result.get("passed", 0))
        emit_block(
            f"commit 被阻断。测试未通过（runner: {runner}）：\n\n{fail_str}\n\n"
            "请修复失败用例后重新 commit。测试通过后 hook 会自动放行。",
            reason_key="test_failed"
        )

    emit_pass()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # 门禁 fail-closed（评审批次一 P0-1a，2026-09-08 评审活体）：
        # 未预期异常 = 状态未知 = 阻断。旧行为 exit 1 会被钩子框架当
        # "非阻断错误"处理 → fail-safe 门禁翻成 fail-open 静默放行
        # （触发例：非 UTF-8 清单的 UnicodeDecodeError 穿透无保护循环）
        print(f"REGRESS-GUARD: 门禁未预期异常，fail-safe 阻断（修好后重试）:\n"
              f"{traceback.format_exc()[-600:]}", file=sys.stderr)
        sys.exit(2)
