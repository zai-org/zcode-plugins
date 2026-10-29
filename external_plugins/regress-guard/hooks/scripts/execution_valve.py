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
    """返回阻断原因列表（空=放行）。project_dir 缺省取 env/cwd。

    v1.90.1（107）载荷剥离：CATASTROPHIC 匹配跑在剥 heredoc 体+引号段后的
    文本上——引号内是数据不是命令（活体 ×2：grep 模式串/落账文本里的危险词
    被当真命令拆）。**解释器入口例外**：bash/sh -c、eval、ssh、xargs sh 段
    保留原文扫描——复制脚本/CI 单串的手滑确实把真命令藏在引号里（顾问微修）。
    RM_RF 检测在去引号文本、目标提取在原文（引号路径不丢）。威胁模型：阀防
    误操作不防对抗（对抗面归门禁/信任表白名单）——但手滑藏引号属误操作，
    故解释器入口不豁免。"""
    if not command or TOKEN in command:
        return []
    if project_dir is None:
        project_dir = _project_dir()
    reasons = []
    _INTERPRETER = re.compile(
        r'\b(?:bash|sh|zsh|dash|ksh)\s+-c\b|\beval\b|\bssh\b|\bxargs\s+'
        r'(?:\w*sh|bash)')
    try:
        from boundary_guard import _strip_heredoc_bodies, _dequote
    except ImportError:
        _strip_heredoc_bodies = _dequote = None
    # heredoc 体先于段切分剥离——按 \n 切段会把体切成独立段（本批活体），
    # 事后再剥已无效；091 同款全命令级剥离。
    if _strip_heredoc_bodies:
        command = _strip_heredoc_bodies(command)
    segments = _SEGMENT_SPLIT.split(command)
    for seg in segments:
        interpreter_seg = False
        if _dequote:
            probe = _dequote(seg)
            # 解释器入口：载荷真的会执行——回原文匹配
            interpreter_seg = bool(_INTERPRETER.search(probe))
            scan_segs = [seg, probe] if interpreter_seg else [probe]
        else:
            probe = seg
            scan_segs = [seg]
        for scan in scan_segs:
            for label, pat in CATASTROPHIC:
                if pat.search(scan):
                    reasons.append(f"{label} ← 「{seg.strip()[:80]}」")
        # RM_RF 检测段：解释器段用原文（引号内 rm 同属手滑），其余用去引号文本
        if RM_RF[0].search(seg if interpreter_seg else probe):
            dangerous = _rm_targets_dangerous(seg, project_dir)
            if dangerous:
                reasons.append(
                    f"项目外不可恢复删除: rm 目标 {', '.join(dangerous[:3])}"
                    f" ← 「{seg.strip()[:80]}」"
                )
    return reasons


def _fail_closed(reason):
    """fail-closed（批135，P0-1c 全量收口）：载荷契约破坏/内部异常一律拦。

    旧行为：非 dict 只修了一半（无说明静默 exit 2），其余未捕获异常 →
    traceback → exit 1 → 阀门放行。逃生阀前置（顾问条件）：_valve_disabled
    只读 config/env，不碰载荷解析。
    """
    try:
        if _valve_disabled():
            sys.exit(0)
    except Exception:
        pass
    try:
        print(
            f"REGRESS-GUARD: ⛔ 执行阀 fail-closed\n"
            f"  {reason}\n\n"
            f"  阀门无法判定状态时按「拦」处理——这是设计不是故障\n"
            f"  （静默放行=不可逆命令无守卫）。\n"
            f"  · 修复/排查后重试\n"
            f"  · 确要执行 → 命令前显式加令牌 {TOKEN}（禁止习惯性携带）\n"
            f"  · 关闭阀门（留痕）：.regress/config.json 设 execution_valve: false",
            file=sys.stderr,
        )
    except Exception:
        pass
    sys.exit(2)


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # 批135（顾问裁决②）：畸形 JSON 统一拦截——stdin 来自宿主，
        # 畸形=宿主契约破坏；旧行为 exit 0 放行 = 阀门可被形态绕过
        _fail_closed("载荷不是合法 JSON（宿主契约破坏）")

    # 灾难级命令阀 fail-closed（评审批次一 P0-1c + 批135 补说明）
    if not isinstance(data, dict):
        _fail_closed("载荷不是 JSON 对象（非 dict 形态）")

    if data.get("tool_name", "") != "Bash":
        sys.exit(0)
    ti = data.get("tool_input", {})
    if not isinstance(ti, dict):
        # 批135：非 dict tool_input 统一拦（原空命令静默放行=形态绕过面）
        _fail_closed("tool_input 不是 JSON 对象")
    command = ti.get("command") or ""
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
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # 全局兜底（批135，照 pre_commit_guard P0-1a 形态）：未捕获异常→拦
        _fail_closed(f"内部异常 {type(e).__name__}: {e}")
