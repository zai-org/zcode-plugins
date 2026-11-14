#!/usr/bin/env python3
"""advisor_token — 本地 dsh 顾问 token 三级回退读取器（批139）。

10-23 dsh 0.2.1 迁移实证：内核不再读 ~/.dsh/settings.yaml，正字挪到
~/.dsh/profiles/web/cordis.patch.yml——旧读取器当场 no_token。三级回退：
  ① env ADVISOR_DSH_TOKEN（运维/测试覆写；空串=未设置）
  ② ~/.dsh/profiles/web/cordis.patch.yml 的 advisor.token（新正字）
  ③ ~/.dsh/settings.yaml 的 advisor.token（旧机/一次性垫片形态）

静默分级（顾问增补）：文件缺失或无匹配键 → 静默走下一级（合法布局差）；
文件在场但解析异常 → stderr WARN（记路径不记值）再走下一级——cordis 格式
漂移不许被悄悄垫片掩盖；三级全空 → 一行列已试路径（无值）返回 None。
"""
import os
import re
import sys

_TOKEN_SHAPE = re.compile(r"^dsha_[A-Za-z0-9_-]{16,}$")  # 形态校验（顾问增补）

_CACHE = {}


def _parse_advisor_token(path):
    """零依赖 YAML-lite：advisor: 块内 2 空格缩进的 token: 行。

    解析异常由调用方分级（缺失=静默；在场但炸=WARN）。"""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    text = text.replace("\r\n", "\n")  # CRLF 容错（顾问增补）
    parts = re.split(r"^advisor:\s*$", text, flags=re.M)
    if len(parts) < 2:
        return None
    seg = re.split(r"^[A-Za-z][\w-]*:\s*$", parts[1], flags=re.M)[0]
    m = re.search(r"^[ \t]*token:\s*['\"]?([^'\"\s#]+)", seg, re.M)
    return m.group(1) if m else None


def _try_file(path, label):
    """读单级：缺失/无键=静默 None；在场但异常=WARN 后 None（分级原则）。"""
    if not os.path.isfile(path):
        return None
    try:
        tok = _parse_advisor_token(path)
    except (IOError, OSError, UnicodeDecodeError) as e:
        print(f"regress-guard: ⚠️ advisor token 解析失败（{label} {path}，"
              f"将走下一级回退）: {type(e).__name__}", file=sys.stderr)
        return None
    if tok is None:
        return None  # 无匹配键=合法布局差，静默
    if not _TOKEN_SHAPE.match(tok):
        print(f"regress-guard: ⚠️ advisor token 形态异常（{label} {path}，"
              f"将走下一级回退）", file=sys.stderr)
        return None
    return tok


def read_advisor_token():
    """三级回退读 token；全空返回 None（stderr 一行列已试路径，无值）。"""
    key = ("advisor_token", os.path.expanduser("~"))
    if key in _CACHE:
        return _CACHE[key]
    env_tok = os.environ.get("ADVISOR_DSH_TOKEN", "").strip()
    if env_tok:
        _CACHE[key] = env_tok
        return env_tok
    home = os.path.expanduser("~")
    candidates = (
        (os.path.join(home, ".dsh", "profiles", "web", "cordis.patch.yml"),
         "新正字"),
        (os.path.join(home, ".dsh", "settings.yaml"), "旧配置"),
    )
    tok = None
    for path, label in candidates:
        tok = _try_file(path, label)
        if tok:
            break
    if tok is None:
        print("regress-guard: advisor token 三级全空（已试：env "
              "ADVISOR_DSH_TOKEN / ~/.dsh/profiles/web/cordis.patch.yml / "
              "~/.dsh/settings.yaml，均未取到）", file=sys.stderr)
    _CACHE[key] = tok
    return tok
