#!/usr/bin/env python3
"""execution_valve — 执行阀（公理四：建议权与执行权彻底剥离）。

LLM 的建议是概率猜测，不可逆执行是物理确定性动作——两者之间必须有
"拆弹密码"级的单向阀门。本阀只认令牌，不听理由：

  灾难级命令（mkfs / dd if= / force push / DROP/TRUNCATE / chmod -R 777 /
  项目外 rm -rf）默认 exit 2 阻断；
  命令中显式含令牌 REGRESS_CONFIRM=YES 才放行——令牌必须由意图方亲手敲入，
  AI 不得替用户默认携带。

关闭途径（显式、留痕）：
  - env REGRESS_VALVE=off（紧急，如 /regress:bypass 场景）
  - .regress/config.json {"execution_valve": false}（项目级长期关闭）

顾问意见（auto-consult）与此阀的关系：顾问永远只产生文本 additionalContext，
不持有任何执行权限——猜测流与执行流物理隔离。

事件: PreToolUse(Bash)，stdin JSON 同其他 hook
退出码: 0=放行，2=阻断（stderr 展示拆弹说明）
"""
import sys
import os
import re
import json
import tempfile

TOKEN = "REGRESS_CONFIRM=YES"

# 灾难级模式：几乎无合法未确认用途 → 无令牌即阻断
CATASTROPHIC = [
    ("格式化磁盘", re.compile(r"\bmkfs(\.\w+)?\b")),
    ("裸写磁盘 dd", re.compile(r"\bdd\s+if=")),
    ("强推覆盖远端", re.compile(r"\bgit\s+push\b.*(\s--force\b|\s-f\b)(\s|$)")),
    ("删库 DROP/TRUNCATE", re.compile(r"\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b", re.I)),
    ("全员可写 chmod 777", re.compile(r"\bchmod\s+-\w*R\w*\s+777\b")),
]

# rm -rf 单列：合法清理太常见，只拦"物理上不可恢复"的目标——
# 绝对路径且在 /tmp 与项目目录之外（项目内相对路径 git 可恢复，归 risk_watch 记录）
RM_RF = [
    re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b"),
]

_SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\n")


def _project_dir():
    d = (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    return os.path.abspath(d)


def _rm_targets_dangerous(segment, project_dir):
    """提取 rm 的目标参数，判断是否落在不可恢复区（/tmp 与项目外绝对路径）。"""
    m = RM_RF[0].search(segment)
    if not m:
        return None
    tokens = segment[m.end():].split()
    # 标准 rm 语义：flags 之后的第一个非 flag token 起全部是目标
    targets = []
    for i, tk in enumerate(tokens):
        if tk == "--":
            targets.extend(tokens[i + 1:])
            break
        if tk.startswith("-"):
            continue
        targets.extend(tokens[i:])
        break
    if not targets:
        return None
    home = os.path.expanduser("~")
    tmp_root = os.path.realpath(tempfile.gettempdir())
    dangerous = []
    for t in targets:
        t_exp = os.path.expanduser(t)
        if "$" in t_exp:
            t_exp = home  # $VAR 展开结果不可知，按最坏情况处理
        if not os.path.isabs(t_exp):
            continue  # 相对路径 = 项目内，git 可恢复
        real = (os.path.realpath(t_exp) if os.path.exists(t_exp)
                else os.path.normpath(t_exp))
        if real == "/":
            dangerous.append(t)
            continue
        if real == tmp_root or real.startswith(tmp_root + os.sep):
            continue  # /tmp 清理可接受
        if real == project_dir or real.startswith(project_dir + os.sep):
            continue  # 项目内，git 可恢复
        dangerous.append(t)
    return dangerous or None


def _valve_disabled():
    """显式关闭（env 或项目 config）。关闭是显式决策，不是默认。"""
    if os.environ.get("REGRESS_VALVE", "").lower() in ("off", "0", "false"):
        return True
    d = _project_dir()
    for _ in range(10):
        cfg = os.path.join(d, ".regress", "config.json")
        if os.path.exists(cfg):
            try:
                with open(cfg, encoding="utf-8") as f:
                    if json.load(f).get("execution_valve") is False:
                        return True
            except (IOError, OSError, json.JSONDecodeError):
                pass
            break
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return False


def evaluate(command, project_dir=None):
    """返回阻断原因列表（空=放行）。project_dir 缺省取 env/cwd。"""
    if not command or TOKEN in command:
        return []
    if project_dir is None:
        project_dir = _project_dir()
    reasons = []
    segments = _SEGMENT_SPLIT.split(command)
    for seg in segments:
        for label, pat in CATASTROPHIC:
            if pat.search(seg):
                reasons.append(f"{label} ← 「{seg.strip()[:80]}」")
        if RM_RF[0].search(seg):
            dangerous = _rm_targets_dangerous(seg, project_dir)
            if dangerous:
                reasons.append(
                    f"项目外不可恢复删除: rm 目标 {', '.join(dangerous[:3])}"
                    f" ← 「{seg.strip()[:80]}」"
                )
    return reasons


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    # 灾难级命令阀 fail-closed（评审批次一 P0-1c）：顶层非 dict 载荷
    # 旧代码 data.get 直接 AttributeError → exit 1 = 放行，与阀门语义相反
    # （tool_input 非 dict 由下方 isinstance 判断兜住，无需强转）
    if not isinstance(data, dict):
        sys.exit(2)

    if data.get("tool_name", "") != "Bash":
        sys.exit(0)
    ti = data.get("tool_input", {})
    command = (ti.get("command") or "") if isinstance(ti, dict) else ""
    if not command:
        sys.exit(0)

    if _valve_disabled():
        sys.exit(0)

    reasons = evaluate(command)
    if not reasons:
        sys.exit(0)

    print(
        "REGRESS-GUARD 执行阀（公理四：不听猜测，只看令牌）：\n"
        "以下操作物理不可逆，AI 的任何理由都属概率猜测，不能作为执行依据：\n"
        + "\n".join(f"  💣 {r}" for r in reasons) +
        "\n\n拆弹方式（二选一）：\n"
        f"  1. 确认真的要做：在命令前显式加令牌 {TOKEN}，例如：\n"
        f"       {TOKEN} <原命令>\n"
        "     （令牌必须是人类或你基于人类明确授权敲入的，禁止习惯性携带）\n"
        "  2. 改用可恢复路径：git 可恢复的项目内清理不用令牌；"
        "数据先备份再操作\n\n"
        "关闭阀门（留痕）：.regress/config.json 设 \"execution_valve\": false，"
        "或环境变量 REGRESS_VALVE=off",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
