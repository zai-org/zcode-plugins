#!/usr/bin/env python3
"""execution_valve — 执行阀（公理四：建议权与执行权彻底剥离）。

LLM 的建议是概率猜测，不可逆执行是物理确定性动作——两者之间必须有
"拆弹密码"级的单向阀门。本阀只认令牌，不听理由：

  灾难级命令（mkfs / dd if= / force push / DROP/TRUNCATE / chmod -R 777 /
  项目外 rm -rf）默认 exit 2 阻断；
  命令中显式含令牌 REGRESS_CONFIRM=YES 才放行——令牌必须由意图方亲手敲入，
  AI 不得替用户默认携带。

关闭途径（显式、留痕）：
  - env REGRESS_VALVE=off（紧急，如 /regress-bypass 场景）
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(SCRIPT_DIR, "lib")
if LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)

from host_env import (ensure_utf8_stdio, is_root, path_within,  # noqa: E402
                      is_abs_any, win_form)  # 批191/195：跨平台根/包含/绝对性判定

TOKEN = "REGRESS_CONFIRM=YES"

# 灾难级模式：几乎无合法未确认用途 → 无令牌即阻断
CATASTROPHIC = [
    ("格式化磁盘", re.compile(r"\bmkfs(\.\w+)?\b")),
    ("裸写磁盘 dd", re.compile(r"\bdd\s+if=")),
    ("强推覆盖远端", re.compile(r"\bgit\s+push\b.*(\s--force\b|\s-f\b)(\s|$)")),
    ("删库 DROP/TRUNCATE", re.compile(r"\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b", re.I)),
    ("全员可写 chmod 777", re.compile(r"\bchmod\s+-\w*R\w*\s+777\b")),
    # 批193+194（公网 issue#2 P0-3 + 遗留3）：PowerShell 灾难级——dsh(pwsh) 下这些
    # 全部绕过 POSIX 模式。Format-Volume 系是裸磁盘操作，无"项目内"概念，
    # 维持无条件拦；递归删三方言（Remove-Item -Recurse / rd|del /s）批195
    # 移出本表改目标判定（见 RM_RECURSIVE）——项目内清理与 rm -rf 对称。
    ("磁盘格式化", re.compile(r"\b(Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition)\b", re.I)),
]

# rm -rf 单列：合法清理太常见，只拦"物理上不可恢复"的目标——
# 绝对路径且在 /tmp 与项目目录之外（项目内相对路径 git 可恢复，归 risk_watch 记录）
RM_RF = [
    re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b"),
]

# ─── 批195（公网 issue#2 第三轮）：递归删三方言统一目标判定 ──────────
# v2.8.2/3 把 PowerShell 递归删直接进 CATASTROPHIC 无条件拦——与 POSIX
# rm -rf 不对称：`rm -rf ./build` 放行而 `Remove-Item -Recurse -Force
# ./build` 被拦。dsh 在 Windows 只投递 pwsh，项目内 build/dist/
# node_modules 日常清理全断；"每次清理带令牌"训练习惯性携带，反而削弱
# 令牌信号价值（用户实测五形态全误拦）。改法：三方言同走 _target_dangerous
# （相对=项目内放行 / 临时区放行 / 根与项目外绝对路径拦）。
# PowerShell：Remove-Item 及全部官方别名（rm/ri/del/erase/rd/rmdir），
# -Recurse 有无 -Force 皆递归（-Force 只影响只读文件是否中断）。
PS_RM = re.compile(
    r"\b(Remove-Item|ri|rm|erase|del|rd|rmdir)\b(?=[^;|&\n]*\s-Recurse)", re.I)
# cmd：rd/rmdir/del 带 s 开关（含组合 /sq /qs）；纯 /q 静默单文件删不递归
# 不算（第三轮附带误拦修复）。开关须独立成词（前置空白+后非词符）——
# `del src/sub` 的路径斜杠段不当开关。
CMD_RM = re.compile(
    r"\b(rd|rmdir|del)\b(?=[^;|&\n]*\s/[a-z]*s[a-z]*(?![\w]))", re.I)
# Remove-Item 取值参数：-Path/-LiteralPath 的值是目标；其余取值参数的值
# 不是路径。开关参数（-Recurse/-Force/-WhatIf/-Confirm）无值跳过。
_PS_RM_PATH_PARAMS = ("-path", "-literalpath")
_PS_RM_VALUE_PARAMS = ("-filter", "-include", "-exclude",
                       "-stream", "-credential")

_SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\n")


def _project_dir():
    d = (
        os.environ.get("ZCODE_PROJECT_DIR")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.getcwd()
    )
    return os.path.abspath(d)


def _strip_quotes(tk):
    """剥 token 两端配对引号（引号内路径不丢）。"""
    if len(tk) >= 2 and tk[0] == tk[-1] and tk[0] in "\"'":
        return tk[1:-1]
    return tk


def _win_norm(p):
    """Windows 形态归一（批195）：斜杠折反斜杠、整体小写（NTFS 全路径
    大小写不敏感，不只盘符）、去尾分隔符。"""
    return p.replace("/", "\\").lower().rstrip("\\")


def _win_is_root(p):
    n = _win_norm(p)
    if len(n) == 2 and n[1] == ":":
        return True  # 盘符根 D:\
    return n.startswith("\\\\") and n.count("\\") <= 2  # \\srv\share


def _win_within(child, parent):
    """Windows 形态包含判定（大小写不敏感——NTFS 语义）。"""
    c, pa = _win_norm(child), _win_norm(parent)
    return c == pa or c.startswith(pa + "\\")


def _target_dangerous(t, project_dir, tmp_root):
    """单删除目标判定（批195，三方言共用）。

    相对路径 = 项目内放行（git 可恢复）；根/项目外绝对路径 = 拦；临时区
    放行；变量展开（$/%）不可知按最坏情形。Windows 形态目标走逐字符串
    分支——POSIX 宿主的 realpath/abspath 会把它折进 cwd 成幻影路径
    （`C:\\data` 被判"项目内"假放行），跨方言比较只在 project/tmp 同为
    Windows 形态时才可能放行（真 Windows 宿主即是）。"""
    t_exp = os.path.expanduser(t)
    if "$" in t_exp or "%" in t_exp:
        t_exp = os.path.expanduser("~")  # 展开结果不可知，按最坏情况处理
    if not is_abs_any(t_exp):
        return False  # 相对路径 = 项目内，git 可恢复
    if win_form(t_exp):
        if _win_is_root(t_exp):
            return True
        for zone in (tmp_root, project_dir):
            if win_form(zone) and _win_within(t_exp, zone):
                return False  # 临时区/项目内（同方言才有可比性）
        return True
    real = (os.path.realpath(t_exp) if os.path.exists(t_exp)
            else os.path.normpath(t_exp))
    # 批191：根/包含判定走 host_env 助手——is_root 通吃 POSIX/盘符/UNC
    # （字面 == "/" 在 Windows 恒假=阀根保护失效）；path_within 折盘符
    # 大小写（env 与 realpath 给的 "C:"/"c:" 不一致时项目内误判为外）
    if is_root(real):
        return True
    if path_within(real, tmp_root):
        return False  # 临时区清理可接受
    if path_within(real, project_dir):
        return False  # 项目内，git 可恢复
    return True


def _dangerous_targets(targets, project_dir):
    tmp_root = os.path.realpath(tempfile.gettempdir())
    return [t for t in targets if _target_dangerous(t, project_dir, tmp_root)]


def _ps_rm_targets(segment):
    """Remove-Item 段提取删除目标：先命名路径参数（-Path/-LiteralPath），
    位置参数兜底；其余取值参数跳名+值，开关跳名。逗号数组展开、引号剥壳。"""
    m = PS_RM.search(segment)
    if not m:
        return []
    tokens = segment[m.end():].split()
    targets, i = [], 0
    while i < len(tokens):
        tk = tokens[i]
        low = tk.lower()
        if tk == "--":
            targets.extend(tokens[i + 1:])
            break
        if low in _PS_RM_PATH_PARAMS:
            if i + 1 < len(tokens):
                targets.append(_strip_quotes(tokens[i + 1]))
            i += 2
            continue
        if low in _PS_RM_VALUE_PARAMS:
            i += 2  # 名+值都跳（值不是路径目标）
            continue
        if tk.startswith("-"):
            i += 1  # 开关
            continue
        targets.append(_strip_quotes(tk))
        i += 1
    # 逗号数组（-Path a,b 或 a,b,c）：逐段判定不失位
    out = []
    for t in targets:
        out.extend(p for p in t.split(",") if p)
    return out


def _cmd_rm_targets(segment):
    """cmd rd/rmdir/del 段提取目标：跳过 / 开关 token，其余皆目标。"""
    m = re.search(r"\b(?:rd|rmdir|del)\b", segment, re.I)
    if not m:
        return []
    return [_strip_quotes(tk) for tk in segment[m.end():].split()
            if not tk.startswith("/")]


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
    return _dangerous_targets(targets, project_dir) or None


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
        # 批195：PowerShell/cmd 递归删目标判定（检测在去引号文本、提取在
        # 原文，同 RM_RF 纪律）。无法定位目标（管道输入形态）按拦——
        # fail-closed，位置/命名参数形态不受影响。
        for pat, extractor, label in (
            (PS_RM, _ps_rm_targets, "Remove-Item"),
            (CMD_RM, _cmd_rm_targets, "cmd rd/del"),
        ):
            if pat.search(seg if interpreter_seg else probe):
                targets = extractor(seg)
                if not targets:
                    reasons.append(
                        f"{label} 递归删但无法确定目标（管道输入？改用位置/"
                        f"命名参数显式指定目标） ← 「{seg.strip()[:80]}」"
                    )
                else:
                    dangerous = _dangerous_targets(targets, project_dir)
                    if dangerous:
                        reasons.append(
                            f"项目外不可恢复删除: {label} 目标 "
                            f"{', '.join(dangerous[:3])} ← 「{seg.strip()[:80]}」"
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
    ensure_utf8_stdio()  # 批191：cp936 流垫片（emoji/中文输出根治）
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
