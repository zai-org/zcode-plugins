#!/usr/bin/env python3
"""secret_scan — gitleaks-lite（v1.42 供应链层，REGRESS-2026-031）。

门禁只验"测试过了"不验"密钥漏没漏"——本层补安全面：扫 staged diff 的
**新增行**（历史密钥审计是全仓工具的职责，不是提交门禁的）。零依赖纯 Python。

双层模式：
- 高精度（误报成本=一次 bypass+修模式，不值得豁免任何路径——真密钥漏在
  测试里也是漏）：AWS AccessKey / GitHub token / 私钥块 / Slack / Google /
  OpenAI sk-
- 通用 key=value 高熵对（噪音大）：tests/ 与 *.md 豁免（夹具与文档示例是
  合法的假密钥聚集地）

内置允许表：各家文档的标准示例值（AWS 文档的 AKIAIOSFODNN7EXAMPLE 等）——
项目级追加走 config supply_chain.allowlist。

用法（由 pre_commit_guard 4.7 调用，也可独立诊断）：
  secret_scan.py <<< "$(git diff --staged -U0)"
"""
import re
import sys

HIGH = [
    ("AWS AccessKey", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("GitHub Token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("私钥块", re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----")),
    ("Slack Token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Google API Key", re.compile(r"AIza[0-9A-Za-z\-_]{35}")),
    ("OpenAI Key", re.compile(r"sk-[A-Za-z0-9_\-]{30,}")),
]
GENERIC = re.compile(
    r"(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]"
    r"[A-Za-z0-9_\-/+=.]{20,}['\"]", re.I)

# 各家官方文档的标准示例值（截断处不遮蔽：这些是公开的教学串）
BUILTIN_ALLOWLIST = {
    "AKIAIOSFODNN7EXAMPLE",            # AWS 文档 AccessKey 示例
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",  # AWS 文档 Secret 示例
}


def scan_added_lines(diff_text, allowlist=()):
    """扫 git diff（建议 -U0）新增行。返回 [(模式, 文件, 行号, 截断串)]。

    行号语义：hunk @@ 头的新侧起始行 + 前缀 + 行数；删除行（^-）不扫
    ——只扫新增（本次提交引入了什么）。"""
    allow = set(BUILTIN_ALLOWLIST) | set(allowlist)
    hits, cur_file, cur_line = [], "", 0
    for raw in diff_text.splitlines():
        if raw.startswith("+++ b/"):
            cur_file = raw[6:]
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            cur_line = int(m.group(1)) if m else 0
        elif raw.startswith("+") and not raw.startswith("+++"):
            line = raw[1:]
            hit = None
            for name, pat in HIGH:
                m = pat.search(line)
                if m and m.group(0) not in allow:
                    hit = (name, cur_file, cur_line, m.group(0)[:14] + "…")
                    break
            if hit is None and not (cur_file.startswith("tests/")
                                    or cur_file.endswith(".md")):
                m = GENERIC.search(line)
                if m and m.group(0) not in allow:
                    hit = ("通用密钥对", cur_file, cur_line, m.group(0)[:18] + "…")
            if hit:
                hits.append(hit)
            cur_line += 1
        elif raw.startswith("-"):
            continue
    return hits


def main():
    diff = sys.stdin.read() if not sys.stdin.isatty() else ""
    hits = scan_added_lines(diff)
    if not hits:
        print("✅ 新增行无密钥命中")
        return 0
    for name, f, ln, snip in hits[:10]:
        print(f"🚨 {name} {f}:{ln} {snip}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
